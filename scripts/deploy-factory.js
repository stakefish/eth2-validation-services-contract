// To deploy a factory contract to Goerli, use the following command:
// npx hardhat run scripts/deploy-factory.js --network goerli

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  const Factory = await ethers.getContractFactory("StakefishServicesContractFactory");
  const factory = await Factory.deploy(100_000); // 10% commission

  console.log("StakefishServicesContractFactory address:", factory.address);
  console.log("StakefishServicesContract impl address:", await factory.getServicesContractImpl())
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
