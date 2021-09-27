const hre = require('hardhat');
const { expect } = require('chai');

describe('Operator Permissions', function () {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  let StakefishServicesContractFactory;
  let stakefishServicesContractFactory;

  let accounts;

  // Deploy contract
  beforeEach(async function () {
    StakefishServicesContractFactory = await hre.ethers.getContractFactory(
      'StakefishServicesContractFactory'
    );

    stakefishServicesContractFactory =
      await StakefishServicesContractFactory.deploy(1000);

    await stakefishServicesContractFactory.deployed();

    accounts = await hre.ethers.getSigners();
  });

  it('Can change operator address', async function () {
    // Check that current operator is account 0
    expect(
      await stakefishServicesContractFactory.getOperatorAddress()
    ).to.be.equal(accounts[0].address);

    // Change operator to account 1
    var tx = await stakefishServicesContractFactory.changeOperatorAddress(
      accounts[1].address
    );

    // Check tx not reverted
    expect(tx).to.be.ok;

    // check operator changed correctly
    expect(
      await stakefishServicesContractFactory.getOperatorAddress()
    ).to.be.equal(accounts[1].address);
  });

  it('Can\'t change operator address from unauthorized account', async function () {
    // Check that current operator is account 0
    expect(
      await stakefishServicesContractFactory.getOperatorAddress()
    ).to.be.equal(accounts[0].address);

    // Check tx is reverted
    await expect(
      stakefishServicesContractFactory
        .connect(accounts[2])
        .changeOperatorAddress(accounts[1].address)
    ).to.be.reverted;

    // Check that current operator is still account 0
    expect(
      await stakefishServicesContractFactory.getOperatorAddress()
    ).to.be.equal(accounts[0].address);
  });

  it('Can\'t change operator address to the zero address', async function () {
    // Check tx is reverted
    await expect(stakefishServicesContractFactory.changeOperatorAddress(ZERO_ADDRESS))
      .to.be.reverted;

    // Check that current operator is still account 0
    expect(
      await stakefishServicesContractFactory.getOperatorAddress()
    ).to.be.equal(accounts[0].address);
  });

  it('Can change commission rate', async function () {
    // Check that current commission rate is 0
    expect(await stakefishServicesContractFactory.getCommissionRate()).to.be.equal(
      1000
    );

    // Change commission rate to 1
    var tx = await stakefishServicesContractFactory.changeCommissionRate(
      2000
    );

    // Check tx not reverted
    expect(tx).to.be.ok;

    // check commission rate changed correctly
    expect(await stakefishServicesContractFactory.getCommissionRate()).to.be.equal(
      2000
    );
  });

  it('Can\'t change commission rate from unauthorized account', async function () {
    // Check that current commission rate is 1000
    expect(await stakefishServicesContractFactory.getCommissionRate()).to.be.equal(
      1000
    );

    // Check tx is reverted
    await expect(
      stakefishServicesContractFactory
        .connect(accounts[2])
        .changeCommissionRate(2000)
    ).to.be.reverted;

    // Check that current commission rate is still 1000
    expect(await stakefishServicesContractFactory.getCommissionRate()).to.be.equal(
      1000
    );
  });

  it('Can\'t change commission rate to a value that exceeds the commission rate scale', async function () {
    // Check that current commission rate is 1000
    expect(await stakefishServicesContractFactory.getCommissionRate()).to.be.equal(
      1000
    );

    // Check tx is reverted
    await expect(
      stakefishServicesContractFactory.changeCommissionRate(1000000 + 1)
    ).to.be.reverted;

    // Check that current commission rate is still 1000
    expect(await stakefishServicesContractFactory.getCommissionRate()).to.be.equal(
      1000
    );
  });
});
