const { spawn } = require("child_process")
const program = require("commander")
const nunjucks = require("nunjucks")
const fs = require("fs")
const web3 = require("web3")

const validators = require("./validators")

// load and execute DojimaChain validator set
require("./generate-dojimavalidatorset")

program.version("0.0.1")
program.option("-c, --dojima-chain-id <dojima-chain-id>", "Dojima chain id", "1001")
program.option(
  "-o, --output <output-file>",
  "Genesis json file",
  "./genesis.json"
)
program.option(
  "-t, --template <template>",
  "Genesis template json",
  "./genesis-template.json"
)
program.parse(process.argv)

// compile contract
function compileContract(key, contractFile, contractName) {
  return new Promise((resolve, reject) => {
    const ls = spawn("solc", [
      "--bin-runtime",
      "openzeppelin-solidity/=node_modules/openzeppelin-solidity/",
      "solidity-rlp/=node_modules/solidity-rlp/",
      "/=/",
      // "--optimize",
      // "--optimize-runs",
      // "200",
      contractFile
    ],{shell: true})

    const result = []
    ls.stdout.on("data", data => {
      result.push(data.toString())
    })

    ls.stderr.on("data", data => {
      result.push(data.toString())
    })

    ls.on("close", code => {
      console.log(`child process exited with code ${code}`)
      const fn = code === 0 ? resolve : reject
      fn(result.join(""))
    })
  }).then(compiledData => {
    compiledData = compiledData.replace(
      new RegExp(`======= ${contractFile}:${contractName} =======\nBinary of the runtime part:` + '[ ]?'),
      "@@@@"
    )

    const matched = compiledData.match(/@@@@\n([a-f0-9]+)/)
    return { key, compiledData: matched[1], contractName, contractFile }
  })
}

// compile files
Promise.all([
  compileContract(
    "dojimaValidatorSetContract",
    "contracts/DojimaValidatorSet.sol",
    "DojimaValidatorSet"
  ),
  compileContract(
    "dojimaStateReceiverContract",
    "contracts/StateReceiver.sol",
    "StateReceiver"
  ),
  compileContract(
    "dojimaChildERC20Contract",
    "dojima-contracts/contracts/child/DRC20.sol",
    "DRC20"
  )
]).then(result => {
  const totalDojSupply = web3.utils.toBN("10000000000")

  var validatorsBalance = web3.utils.toBN(0)
  validators.forEach(v => {
    validatorsBalance = validatorsBalance.add(web3.utils.toBN(v.balance))
    v.balance = web3.utils.toHex(web3.utils.toWei(String(v.balance)))
  })

  const contractBalance = totalDojSupply.sub(validatorsBalance)
  const data = {
    chainId: program.dojimaChainId,
    validators: validators,
    dojimaChildERC20ContractBalance: web3.utils.toHex(
      web3.utils.toWei(contractBalance.toString())
    )
  }

  result.forEach(r => {
    data[r.key] = r.compiledData
  })

  const templateString = fs.readFileSync(program.template).toString()
  const resultString = nunjucks.renderString(templateString, data)
  fs.writeFileSync(program.output, resultString)
}).catch(err => {
  console.log(err)
  process.exit(1)
})
