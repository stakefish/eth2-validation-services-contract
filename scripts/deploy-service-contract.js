// To deploy a new service contract to Goerli, use the following command:
// npx hardhat run scripts/deploy-service-contract.js --network goerli

const { randomBytes } = require('crypto');
const { BigNumber } = ethers;
const { Keystore } = require('@chainsafe/bls-keystore')

async function main() {
  const lib = await import('../lib/stakefish-services-contract.mjs');
  ({
    NETWORKS,
    bls,
    createOperatorCommitment,
    createOperatorDepositData,
    saltBytesToContractAddress
  } = lib);

  const [deployer] = await ethers.getSigners();

  const operatorPrivKey = bls.SecretKey.fromKeygen();
  const operatorPubKeyBytes = operatorPrivKey.toPublicKey().toBytes();
  const keystorePath = "m/12381/60/0/0";

  const keystore = await Keystore.create(
    "LxeMTGNKAQRCdmv3",
    operatorPrivKey.toBytes(),
    operatorPubKeyBytes,
    keystorePath);

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  const Factory = await ethers.getContractFactory("StakefishServicesContractFactory");
  const factory = await Factory.attach(NETWORKS.GOERLI.FACTORY_ADDRESS);

  const saltBytes = randomBytes(32);
  const contractAddress = saltBytesToContractAddress(saltBytes, NETWORKS.GOERLI);

  const depositData = createOperatorDepositData(
    operatorPrivKey, contractAddress);

  const exitDate = BigNumber.from(new Date(2025).getTime());

  let commitment = createOperatorCommitment(
    contractAddress,
    operatorPubKeyBytes,
    depositData.depositSignature,
    depositData.depositDataRoot,
    exitDate)

  await factory.createContract(saltBytes, commitment);

  console.log("Service contract deployed at: ", contractAddress);
  console.log("Salt bytes: ", saltBytes.toString("hex"));
  console.log("Operator keystore: ", JSON.stringify(keystore));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

