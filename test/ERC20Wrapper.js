const { ethers } = require('hardhat');
const { arrayify, zeroPad, keccak256 } = ethers.utils;
const chai = require('chai');
const ChaiAsPromised = require('chai-as-promised');
const expect = chai.expect;
const BigNumber = ethers.BigNumber;

chai.use(ChaiAsPromised);

describe('ERC20', () => {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const NAME = 'TOKEN';
  const SYMBOL = 'TOKEN';

  let owner, receiver, operator;

  const exitDate = BigNumber.from(new Date().getTime() + 10000);

  let ERC20;
  let servicesContract;

  let bls;
  let createOperatorCommitment;
  let createOperatorDepositData;
  let operatorPrivKey;
  let operatorPubKeyBytes;

  before(async function () {
    const lib = await import('../lib/stakefish-services-contract.mjs');
    ({
      bls,
      createOperatorCommitment,
      createOperatorDepositData,
    } = lib);

    operatorPrivKey = bls.SecretKey.fromKeygen();
    operatorPubKeyBytes = operatorPrivKey.toPublicKey().toBytes();
  });

  beforeEach(async () => {
    [owner, receiver, operator] = await ethers.getSigners();

    const StakefishServicesContractFactory = await ethers.getContractFactory(
      'StakefishServicesContractFactory'
    );

    const StakefishServicesContract = await ethers.getContractFactory(
      'StakefishServicesContract'
    );

    const StakefishERC20Wrapper = await ethers.getContractFactory(
      'StakefishERC20Wrapper'
    );

    const factory = await StakefishServicesContractFactory.deploy(1000);
    await factory.deployed();

    // get tamplete address
    let implAddress = await factory.getServicesContractImpl();

    // Standard bytecode for basic proxy contract for EIP-1167
    let initCodeHash = keccak256('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + implAddress.substring(2) + '5af43d82803e903d91602b57fd5bf3');

    let saltValue = zeroPad(arrayify(BigNumber.from(0)), 32);

    // calculate new contract address
    let newContractAddress = ethers.utils.getCreate2Address(
      factory.address,
      saltValue,
      initCodeHash
    );

    let depositData = createOperatorDepositData(
      operatorPrivKey, newContractAddress
    );

    let commitment = createOperatorCommitment(
      newContractAddress,
      operatorPubKeyBytes,
      depositData.depositSignature,
      depositData.depositDataRoot,
      exitDate
    );

    // Deploy services contract
    await factory.createContract(
      saltValue,
      commitment 
    );

    servicesContract = await StakefishServicesContract.attach(newContractAddress);

    ERC20 = await StakefishERC20Wrapper.deploy();
    await ERC20.deployed();
    await ERC20.initialize(NAME, SYMBOL, servicesContract.address);
  });

  describe('transfer', () => {
    beforeEach(async () => {
      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC20.address, 100);
      await ERC20.mint(100);
    });

    describe('when recipient is zero address', () => {
      it('reverts', async () => {
        const tx = ERC20.transfer(ZERO_ADDRESS, 1);

        await expect(tx).to.be.reverted;
      });
    });

    describe('when recipient is not zero address', () => {
      describe('when sender does not have enough balance', () => {
        const amount = 101;
        it('reverts', async () => {
          const tx = ERC20.transfer(receiver.address, amount);

          await expect(tx).to.be.reverted;
        });
      });

      describe('when sender has enough balance', () => {
        const amount = 10;
        it('transfers the requested amount', async () => {
          await ERC20.transfer(receiver.address, amount);

          expect(await ERC20.balanceOf(owner.address)).to.be.equal(90);
          expect(await ERC20.balanceOf(receiver.address)).to.be.equal(10);
        });

        it('emits a Transfer event', async () => {
          const tx = ERC20.transfer(receiver.address, amount);

          await expect(tx).to.emit(ERC20, 'Transfer')
            .withArgs(owner.address, receiver.address, amount);
        });
      });
    });
  });

  describe('transferFrom', () => {
    beforeEach(async () => {
      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC20.address, 100);
      await ERC20.mint(100);
    });

    describe('when recipient is zero address', () => {
      it('reverts', async () => {
        const tx = ERC20.transferFrom(owner.address, ZERO_ADDRESS, 1);

        await expect(tx).to.be.reverted;
      });
    });

    describe('when recipient is not zero address', () => {
      describe('when sender does not have enough balance', () => {
        const amount = 101;
        it('reverts', async () => {
          await ERC20.approve(operator.address, amount);
          const tx = ERC20.connect(operator).transferFrom(owner.address, receiver.address, amount);

          await expect(tx).to.be.reverted;
        });
      });

      describe('when sender has enough balance', () => {
        const amount = 10;
        it('transfers the requested amount', async () => {
          await ERC20.approve(operator.address, amount);
          await ERC20.connect(operator).transferFrom(owner.address, receiver.address, amount);

          expect(await ERC20.balanceOf(owner.address)).to.be.equal(90);
          expect(await ERC20.balanceOf(receiver.address)).to.be.equal(10);
        });

        it('emits a Transfer event', async () => {
          await ERC20.approve(operator.address, amount);
          const tx = ERC20.connect(operator).transferFrom(owner.address, receiver.address, amount);

          await expect(tx).to.emit(ERC20, 'Transfer')
            .withArgs(owner.address, receiver.address, amount);
        });
      });
    });
  });

  describe('approve', () => {
    describe('when spender is zero address', () => {
      it('reverts', async () => {
        const tx = ERC20.approve(ZERO_ADDRESS, 10);

        await expect(tx).to.be.reverted;
      });
    });

    describe('when spender is not zero address', () => {
      it('emits an Approval event', async () => {
        const tx = ERC20.approve(operator.address, 10);

        await expect(tx).to.emit(ERC20, 'Approval')
          .withArgs(owner.address, operator.address, 10);
      });

      it('approves the requested amount', async () => {
        await ERC20.approve(operator.address, 10);
        
        const allowance = await ERC20.allowance(owner.address, operator.address);
        expect(allowance).to.be.equal(10);
      });

      describe('when spender has an approved history', () => {
        beforeEach(async () => {
          await ERC20.approve(operator.address, 10);
        });

        it('approves the requested amount and replaces the previous approval', async () => {
          await ERC20.approve(operator.address, 20);

          const allowance = await ERC20.allowance(owner.address, operator.address);
          expect(allowance).to.be.equal(20);
        });
      });
    });
  });

  describe('mintTo()', () => {
    beforeEach(async () => {
      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC20.address, 100);
    });

    it('should revert if amount is zero', async () => {
      const tx = ERC20.mintTo(owner.address, 0);
      await expect(tx).to.be.reverted;
    });

    it('should revert if mint more than approved amount', async () => {
      const tx = ERC20.mintTo(owner.address, 101);
      await expect(tx).to.be.reverted;
    });

    it('should be able to mint approved amount', async () => {
      const tx = ERC20.mintTo(owner.address, 100);
      await expect(tx).to.emit(ERC20, 'Mint')
        .withArgs(owner.address, owner.address, 100);
      const ownerDeposit = await servicesContract.getDeposit(owner.address);
      const ERC20Deposit = await servicesContract.getDeposit(ERC20.address);

      expect(ownerDeposit).to.be.equal(0);
      expect(ERC20Deposit).to.be.equal(100);

      const balance = await ERC20.balanceOf(owner.address);
      expect(balance).to.be.equal(100);

      const totalSupply = await ERC20.totalSupply();
      expect(balance).to.be.equal(100);
      expect(totalSupply).to.be.equal(100);
    });

    it('should be able to mint for others', async () => {
      await ERC20.mintTo(receiver.address, 100);

      const ownerBalance = await ERC20.balanceOf(owner.address);
      const receiverBalance = await ERC20.balanceOf(receiver.address);
      expect(ownerBalance).to.be.equal(0);
      expect(receiverBalance).to.be.equal(100);
    });
  });

  describe('redeemTo()', () => {
    beforeEach(async () => {
      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC20.address, 100);
      await ERC20.mint(100);
    });

    it('should revert if operator does not have enough balance', async () => {
      const tx = ERC20.connect(receiver).redeemTo(receiver.address, 100);
      await expect(tx).to.be.reverted;
    });

    it('should be able to redeem if operator has enough balance', async () => {
      const tx = ERC20.redeemTo(owner.address, 100);
      await expect(tx).to.emit(ERC20, 'Redeem')
        .withArgs(owner.address, owner.address, 100);
      const ownerDeposit = await servicesContract.getDeposit(owner.address);
      const ERC20Deposit = await servicesContract.getDeposit(ERC20.address);
      const balance = await ERC20.balanceOf(owner.address);
      const totalSupply = await ERC20.totalSupply();

      expect(ownerDeposit).to.be.equal(100);
      expect(ERC20Deposit).to.be.equal(0);
      expect(balance).to.be.equal(0);
      expect(totalSupply).to.be.equal(0);
    });
  });
});
