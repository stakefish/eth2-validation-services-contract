const hre = require('hardhat');
const { expect } = require('chai');
const { keccak256, zeroPad, arrayify } = require('ethers/lib/utils');
const { ethers } = require('hardhat');
const BigNumber = ethers.BigNumber;

describe('Factory tests', function () {
  const exitDate = BigNumber.from(new Date().getTime() + 10000);

  let StakefishServicesContractFactory;
  let stakefishServicesContractFactory;
  let StakefishServicesContract;

  let accounts;

  let bls;
  let createOperatorCommitment;
  let createOperatorDepositData;

  beforeEach(async function () {
    const lib = await import('../lib/stakefish-services-contract.mjs');
    ({
      bls,
      createOperatorCommitment,
      createOperatorDepositData,
    } = lib);

    StakefishServicesContractFactory = await hre.ethers.getContractFactory(
      'StakefishServicesContractFactory'
    );

    StakefishServicesContract = await hre.ethers.getContractFactory(
      'StakefishServicesContract'
    );

    stakefishServicesContractFactory =
      await StakefishServicesContractFactory.deploy(1000);

    await stakefishServicesContractFactory.deployed();

    accounts = await hre.ethers.getSigners();
  });

  it('Can create a new Service Contract', async function () {
    // Sample salt
    let saltValue =
      '0x7c5ea36004851c764c44143b1dcb59679b11c9a68e5f41497f6cf3d480715331';

    // get template address
    let implAddress = await stakefishServicesContractFactory.getServicesContractImpl();

    // Standard bytecode for basic proxy contract for EIP-1167
    let initCodeHash = keccak256('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + implAddress.substring(2) + '5af43d82803e903d91602b57fd5bf3');

    // calculate new contract address
    let newContractAddress = ethers.utils.getCreate2Address(
      stakefishServicesContractFactory.address,
      saltValue,
      initCodeHash
    );

    let byteCode = await ethers.provider.getCode(newContractAddress);
    expect(byteCode).to.be.equal('0x');

    let operatorPrivKey = bls.SecretKey.fromKeygen();
    let operatorPubKeyBytes = operatorPrivKey.toPublicKey().toBytes();
 
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
    const tx = await stakefishServicesContractFactory.createContract(saltValue, commitment);
    byteCode = await ethers.provider.getCode(newContractAddress);
    const proxyByteCode = '0x363d3d373d3d3d363d73' + implAddress.substring(2).toLowerCase() + '5af43d82803e903d91602b57fd5bf3';

    expect(tx).to.emit(stakefishServicesContractFactory, 'ContractCreated').withArgs(saltValue);
    expect(byteCode).to.be.equal(proxyByteCode);
  });


  it('Can create multiple Services Contracts', async function () {
    // Sample salt
    let saltValues = [
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000000000000000000000000000002',
      '0x0000000000000000000000000000000000000000000000000000000000000003',
    ];

    let dataCommitments = [];
    let newContractAddresses = [];

    // get template address
    let implAddress = await stakefishServicesContractFactory.getServicesContractImpl();

    // Standard bytecode for basic proxy contract for EIP-1167
    let initCodeHash = keccak256('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + implAddress.substring(2) + '5af43d82803e903d91602b57fd5bf3');

    for (let i = 0; i < 4; i++) {
      // calculate new contract address
      let newContractAddress = ethers.utils.getCreate2Address(
        stakefishServicesContractFactory.address,
        saltValues[i],
        initCodeHash
      );
      newContractAddresses.push(newContractAddress);

      let byteCode = await ethers.provider.getCode(newContractAddress);
      expect(byteCode).to.be.equal('0x');

      let operatorPrivKey = bls.SecretKey.fromKeygen();
      let operatorPubKeyBytes = operatorPrivKey.toPublicKey().toBytes();
 
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

      dataCommitments.push(commitment);
    }

    // Deploy multiple services contract
    const tx = await stakefishServicesContractFactory.createMultipleContracts(saltValues[0], dataCommitments);

    const proxyByteCode = '0x363d3d373d3d3d363d73' + implAddress.substring(2).toLowerCase() + '5af43d82803e903d91602b57fd5bf3';
    for (let i = 0; i < 4; i++) {
      let byteCode = await ethers.provider.getCode(newContractAddresses[i]);
      expect(tx).to.emit(stakefishServicesContractFactory, 'ContractCreated').withArgs(saltValues[i]);
      expect(byteCode).to.be.equal(proxyByteCode);
    }
  });

  it('Can create a new Service Contract with funds', async function () {
    // Sample salt
    let saltValue =
      '0x7c5ea36004851c764c44143b1dcb59679b11c9a68e5f41497f6cf3d480715331';

    // get template address
    let implAddress = await stakefishServicesContractFactory.getServicesContractImpl();

    // Standard bytecode for basic proxy contract for EIP-1167
    let initCodeHash = keccak256('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + implAddress.substring(2) + '5af43d82803e903d91602b57fd5bf3');

    // calculate new contract address
    let newContractAddress = ethers.utils.getCreate2Address(
      stakefishServicesContractFactory.address,
      saltValue,
      initCodeHash
    );

    let operatorPrivKey = bls.SecretKey.fromKeygen();
    let operatorPubKeyBytes = operatorPrivKey.toPublicKey().toBytes();
 
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

    // Deploy a services contract 
    const tx = await stakefishServicesContractFactory.createContract(
      saltValue,
      commitment,
      {
        value: ethers.utils.parseEther('5'),
      }
    );

    expect(tx).to.emit(stakefishServicesContractFactory, 'ContractCreated').withArgs(saltValue);

    let servicesContract = StakefishServicesContract.attach(newContractAddress);
    let deposit = await servicesContract.getDeposit(accounts[0].address);
    expect(tx).to.emit(servicesContract, 'Deposit').withArgs(accounts[0].address, ethers.utils.parseEther('5'));
    expect(deposit).to.be.equal(ethers.utils.parseEther('5'));
  });

  describe('fundMultipleContracts()', function() {
    let saltValues;
    let servicesContracts;

    beforeEach(async function() {
      let dataCommitments = [];
      
      let implAddress = await stakefishServicesContractFactory.getServicesContractImpl();
      let initCodeHash = keccak256('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + implAddress.substring(2) + '5af43d82803e903d91602b57fd5bf3');
      saltValues = [];
      servicesContracts = [];

      for (let i = 0; i < 4; i++) {
        saltValues.push(zeroPad(arrayify(i), 32));

        let newContractAddress = ethers.utils.getCreate2Address(
          stakefishServicesContractFactory.address,
          saltValues[i],
          initCodeHash
        );

        let operatorPrivKey = bls.SecretKey.fromKeygen();
        let operatorPubKeyBytes = operatorPrivKey.toPublicKey().toBytes();
 
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

        dataCommitments.push(commitment);
        servicesContracts.push(StakefishServicesContract.attach(newContractAddress));
      }

      await stakefishServicesContractFactory.createMultipleContracts(saltValues[0], dataCommitments);
    });

    describe('when services contracts are empty', function() {
      it('should be able to deposit into empty services contracts', async function() {
        const balanceBefore = await ethers.provider.getBalance(accounts[0].address);
        const tx = await stakefishServicesContractFactory.fundMultipleContracts(
          saltValues,
          false,
          {
            value: ethers.utils.parseEther('30'),
          }
        );
        const receipt = await tx.wait(1);

        for (let i = 1; i < 4; i++) {
          const servicesContractBalance = await ethers.provider.getBalance(servicesContracts[i].address);
          const deposit = await servicesContracts[i].getDeposit(accounts[0].address);
          
          if (i == 0) {
            expect(servicesContractBalance).to.be.equal(ethers.utils.parseEther('30'));
            expect(deposit).to.be.equal(ethers.utils.parseEther('30'));
          } else {
            expect(servicesContractBalance).to.be.equal(0);
            expect(deposit).to.be.equal(0);
          }
        }

        const balanceAfter = await ethers.provider.getBalance(accounts[0].address);
        const gasCost = receipt.gasUsed.mul(tx.gasPrice);
        // Check if it has refunded surplus
        expect(balanceBefore.sub(balanceAfter)).to.be.equal(ethers.utils.parseEther('30').add(gasCost));
      });

      it('should be able to fill multiple empty services contracts', async function() {
        const balanceBefore = await ethers.provider.getBalance(accounts[0].address);
        const tx = await stakefishServicesContractFactory.fundMultipleContracts(
          saltValues,
          false,
          {
            value: ethers.utils.parseEther('130'),
          }
        );
        const receipt = await tx.wait(1);

        for (let i = 0; i < 4; i++) {
          const servicesContractBalance = await ethers.provider.getBalance(servicesContracts[i].address);
          const deposit = await servicesContracts[i].getDeposit(accounts[0].address);

          expect(servicesContractBalance).to.be.equal(ethers.utils.parseEther('32'));
          expect(deposit).to.be.equal(ethers.utils.parseEther('32'));
        }

        const balanceAfter = await ethers.provider.getBalance(accounts[0].address);
        const gasCost = receipt.gasUsed.mul(tx.gasPrice);
        // Check if it has refunded surplus
        expect(balanceBefore.sub(balanceAfter)).to.be.equal(ethers.utils.parseEther('128').add(gasCost));
      });
    });

    describe('when services contracts already have some ethers', function() {
      beforeEach(async function() {
        for (let i = 0; i < 4; i++) {
          await accounts[1].sendTransaction({
            to: servicesContracts[i].address,
            value: ethers.utils.parseEther('31'),
          });
        }
      });

      it('should be able to deposit into multiple empty services contracts', async function() {
        const balanceBefore = await ethers.provider.getBalance(accounts[0].address);
        const tx = await stakefishServicesContractFactory.fundMultipleContracts(
          saltValues,
          false,
          {
            value: ethers.utils.parseEther('130'),
          }
        );
        const receipt = await tx.wait(1);

        for (let i = 0; i < 4; i++) {
          const servicesContractBalance = await ethers.provider.getBalance(servicesContracts[i].address);
          const deposit = await servicesContracts[i].getDeposit(accounts[0].address);

          expect(servicesContractBalance).to.be.equal(ethers.utils.parseEther('32'));
          expect(deposit).to.be.equal(ethers.utils.parseEther('1'));
        }

        const balanceAfter = await ethers.provider.getBalance(accounts[0].address);
        const gasCost = receipt.gasUsed.mul(tx.gasPrice);
        // Check if it has refunded surplus
        expect(balanceBefore.sub(balanceAfter)).to.be.equal(ethers.utils.parseEther('4').add(gasCost));
      });
    });

    describe('when services contracts has less than MINIMUM_DEPOSIT ETH of capacity', function() {
      let minimumDeposit;

      beforeEach(async function() {
        minimumDeposit = await stakefishServicesContractFactory.getMinimumDeposit();
        for (let i = 0; i < 2; i++) {
          await accounts[1].sendTransaction({
            to: servicesContracts[i].address,
            value: ethers.utils.parseEther('32').sub(minimumDeposit).add(1),
          });
        }
      });

      it('should skip the services contracts of insufficient capacity when force is false', async function() {
        const balanceBefore = await ethers.provider.getBalance(accounts[0].address);
        const tx = await stakefishServicesContractFactory.fundMultipleContracts(
          saltValues,
          false,
          {
            value: ethers.utils.parseEther('130'),
          }
        );
        const receipt = await tx.wait(1);

        for (let i = 0; i < 2; i++) {
          const servicesContractBalance = await ethers.provider.getBalance(servicesContracts[i].address);
          const deposit = await servicesContracts[i].getDeposit(accounts[0].address);

          expect(servicesContractBalance).to.be.equal(ethers.utils.parseEther('32').sub(minimumDeposit).add(1));
          expect(deposit).to.be.equal(0);
        }

        for (let i = 2; i < 4; i++) {
          const servicesContractBalance = await ethers.provider.getBalance(servicesContracts[i].address);
          const deposit = await servicesContracts[i].getDeposit(accounts[0].address);

          expect(servicesContractBalance).to.be.equal(ethers.utils.parseEther('32'));
          expect(deposit).to.be.equal(ethers.utils.parseEther('32'));
        }

        const balanceAfter = await ethers.provider.getBalance(accounts[0].address);
        const gasCost = receipt.gasUsed.mul(tx.gasPrice);
        // Check if it has refunded surplus
        expect(balanceBefore.sub(balanceAfter)).to.be.equal(ethers.utils.parseEther('64').add(gasCost));
      });

      it('should be able to deposit into services contracts of insufficient capacity when force is true', async function() {
        const balanceBefore = await ethers.provider.getBalance(accounts[0].address);
        const tx = await stakefishServicesContractFactory.fundMultipleContracts(
          saltValues,
          true,
          {
            value: ethers.utils.parseEther('130'),
          }
        );
        const receipt = await tx.wait(1);

        for (let i = 0; i < 2; i++) {
          const servicesContractBalance = await ethers.provider.getBalance(servicesContracts[i].address);
          const deposit = await servicesContracts[i].getDeposit(accounts[0].address);

          expect(servicesContractBalance).to.be.equal(ethers.utils.parseEther('32'));
          expect(deposit).to.be.equal(minimumDeposit.sub(1));
        }

        for (let i = 2; i < 4; i++) {
          const servicesContractBalance = await ethers.provider.getBalance(servicesContracts[i].address);
          const deposit = await servicesContracts[i].getDeposit(accounts[0].address);

          expect(servicesContractBalance).to.be.equal(ethers.utils.parseEther('32'));
          expect(deposit).to.be.equal(ethers.utils.parseEther('32'));
        }

        const balanceAfter = await ethers.provider.getBalance(accounts[0].address);
        const gasCost = receipt.gasUsed.mul(tx.gasPrice);
        const deposited = ethers.utils.parseEther('64').add(minimumDeposit.mul(2).sub(2));
        // Check if it has refunded surplus
        expect(balanceBefore.sub(balanceAfter)).to.be.equal(deposited.add(gasCost));
      });
    });
  });
});
