const hre = require('hardhat');
const { expect, assert } = require('chai');
const { keccak256 } = require('ethers/lib/utils');
const { ethers } = require('hardhat');
const { BigNumber } = ethers;
const { arrayify, zeroPad, parseEther } = ethers.utils;

async function getTxGasCost(txResponse) {
  const receipt = await txResponse.wait();
  return txResponse.gasPrice.mul(receipt.gasUsed);
}

function eth(num) {
  return parseEther(num.toString());
}

describe('Service contract tests', function () {
  const exitDate = BigNumber.from(new Date().getTime() + 10000);

  let StakefishServicesContractFactory;
  let stakefishServicesContractFactory;
  let proxyInitCodeHash;
  let StakefishServicesContract;

  let accounts;
  let contractsData;
  let serviceContract;

  let operator;
  let alice;
  let bob;
  let carol;

  let State;
  let DEPOSIT_CONTRACT_ADDRESS;

  let createOperatorCommitment;
  let createOperatorDepositData;

  let operatorPrivKey;
  let operatorPubKeyBytes;
  let bls;

  async function verifyCallEffects({
    call,
    args = [],
    value = 0,
    fromAccount,
    verifiedUsers = [],
    expectedDepositsBefore = [],
    expectedDepositsAfter = [],
    expectedDepositDiffs = [],
    expectedETHDiffs = [],
    expectedContractETHBefore,
    expectedContractETHAfter,
    expectedTotalDepositsBefore,
    expectedTotalDepositsAfter,
    expectedContractETHDiff,
    expectedTotalDepositsDiff,
    approval = { depositor: '', spender: '', amount: 0 },
    revert = false
  }) {
    if (approval.depositor != '') {
      await serviceContract.connect(approval.depositor).approveWithdrawal(
        approval.spender.address,
        approval.amount
      );

      let withdrawalAllowance = await serviceContract.withdrawalAllowance(
        approval.depositor.address, approval.spender.address);

      assert.equal(
        withdrawalAllowance.toString(), approval.amount.toString(), 'allowance error'
      );
    }

    async function getUserBalances(user) {
      let balanceETH = await ethers.provider.getBalance(user.address);
      let balanceDeposit = await serviceContract.getDeposit(user.address);
      return [balanceETH, balanceDeposit];
    }

    let userBalancesBefore = await Promise.all(verifiedUsers.map(getUserBalances));
    let usersETHBefore = userBalancesBefore.map(data => data[0]);
    let usersDepositBefore = userBalancesBefore.map(data => data[1]);
    let contractETHBefore = await ethers.provider.getBalance(serviceContract.address);
    let totalDepositsBefore = await serviceContract.getTotalDeposits();

    if (expectedContractETHBefore !== undefined) {
      assert.equal(
        contractETHBefore.toString(),
        expectedContractETHBefore.toString(),
        'incorrect contract eth value before calling ' + call
      );
    }

    if (expectedTotalDepositsBefore !== undefined) {
      assert.equal(
        totalDepositsBefore.toString(),
        expectedTotalDepositsBefore.toString(),
        'incorrect totalDeposits before calling ' + call
      );
    }

    for (let i = 0; i < expectedDepositsBefore.length; ++i) {
      assert.equal(
        usersDepositBefore[i].toString(),
        expectedDepositsBefore[i].toString(),
        'incorrect deposit value before calling ' + call + ' for user ' + verifiedUsers[i].name
      );
    }

    let txCost = eth(0);

    if (value > 0) {
      args.push({value});
    }

    let connection = serviceContract.connect(fromAccount);
    let txResponsePromise = connection[call].apply(connection, args);

    if (!revert) {
      let txResponse = await txResponsePromise;
      txCost = await getTxGasCost(txResponse);
    } else {
      await expect(txResponsePromise).to.be.reverted;
    }

    let userBalancesAfter = await Promise.all(verifiedUsers.map(getUserBalances));
    let usersETHAfter = userBalancesAfter.map(data => data[0]);
    let usersDepositAfter = userBalancesAfter.map(data => data[1]);

    let contractETHAfter = await ethers.provider.getBalance(serviceContract.address);
    let totalDepositsAfter = await serviceContract.getTotalDeposits();

    for (let i = 0; i < expectedDepositsAfter.length; ++i) {
      assert.equal(
        usersDepositAfter[i].toString(),
        expectedDepositsAfter[i].toString(),
        'incorrect deposit value after ' + call + ' for user ' + verifiedUsers[i].name
      );
    }

    for (let i = 0; i < expectedDepositDiffs.length; ++i) {
      assert.equal(
        usersDepositAfter[i].sub(usersDepositBefore[i]).toString(),
        expectedDepositDiffs[i].toString(),
        'incorrect deposit diff for user ' + verifiedUsers[i].name
      );
    }

    for (let i = 0; i < expectedETHDiffs.length; ++i) {
      if (verifiedUsers[i] == fromAccount) {
        continue;
      }
      assert.equal(
        usersETHAfter[i].sub(usersETHBefore[i]).toString(),
        expectedETHDiffs[i].toString(),
        'incorrect ETH diff for user ' + verifiedUsers[i].name + ': ' + verifiedUsers[i]
      );
    }

    if (expectedETHDiffs.length > 0) {
      let idx = verifiedUsers.indexOf(fromAccount);
      if (idx > 0) {
        if (revert) {
          assert.isBelow(
            usersETHAfter[idx],
            usersETHBefore[idx],
            'incorrect ETH diff for user ' + fromAccount.name          );
        } else {
          assert.equal(
            usersETHAfter[idx].sub(usersETHBefore[idx]).add(txCost).toString(),
            expectedETHDiffs[idx].toString(),
            'incorrect ETH diff for user ' + fromAccount.name
          );
        }
      }
    }

    if (expectedContractETHAfter !== undefined) {
      assert.equal(
        contractETHAfter.toString(),
        expectedContractETHAfter.toString(),
        'incorrect contract eth value after'
      );
    }

    if (expectedTotalDepositsAfter !== undefined) {
      assert.equal(
        totalDepositsAfter.toString(),
        expectedTotalDepositsAfter.toString(),
        'incorrect totalDeposits after'
      );
    }

    if (expectedContractETHDiff !== undefined) {
      assert.equal(
        contractETHAfter.sub(contractETHBefore).toString(),
        expectedContractETHDiff.toString(),
        'incorrect contract eth diff'
      );
    }

    if (expectedTotalDepositsDiff !== undefined) {
      assert.equal(
        totalDepositsAfter.sub(totalDepositsBefore).toString(),
        expectedTotalDepositsDiff.toString(),
        'incorrect totalDeposits diff'
      );
    }
  }

  before(async function () {
    const lib = await import('../lib/stakefish-services-contract.mjs');
    ({
      bls,
      State,
      DEPOSIT_CONTRACT_ADDRESS,
      createOperatorCommitment,
      createOperatorDepositData,
    } = lib);

    operatorPrivKey = bls.SecretKey.fromKeygen();
    operatorPubKeyBytes = operatorPrivKey.toPublicKey().toBytes();
  });

  function genContractData(saltValue, exitDate) {
    let saltBytes = zeroPad(arrayify(BigNumber.from(saltValue)), 32);

    var newContractAddress = ethers.utils.getCreate2Address(
      stakefishServicesContractFactory.address,
      saltBytes,
      proxyInitCodeHash
    );

    let depositData = createOperatorDepositData(
      operatorPrivKey, newContractAddress);

    let commitment = createOperatorCommitment(
      newContractAddress,
      operatorPubKeyBytes,
      depositData.depositSignature,
      depositData.depositDataRoot,
      exitDate
    );

    return {
      saltBytes,
      address: newContractAddress,
      commitment,
      depositData
    };
  }

  // Deploy one contract
  beforeEach(async function () {
    StakefishServicesContractFactory = await hre.ethers.getContractFactory(
      'StakefishServicesContractFactory'
    );

    StakefishServicesContract = await hre.ethers.getContractFactory(
      'StakefishServicesContract'
    );

    stakefishServicesContractFactory =
      await StakefishServicesContractFactory.deploy(1000);

    await stakefishServicesContractFactory.deployed();

    // get tamplete address
    let implAddress = await stakefishServicesContractFactory.getServicesContractImpl();

    // Standard bytecode for basic proxy contract for EIP-1167
    proxyInitCodeHash = keccak256('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + implAddress.substring(2) + '5af43d82803e903d91602b57fd5bf3');

    let contracts = [];
    let baseSaltValue = 0;
    var dataCommitments = [];

    for (let i = 0; i < 2; i++) {
      let contractData = genContractData(baseSaltValue + i, exitDate);
      contracts.push(contractData);
      dataCommitments.push(contractData.commitment);
    }

    // Create contracts
    await stakefishServicesContractFactory.createMultipleContracts(
      BigNumber.from(baseSaltValue),
      dataCommitments);

    accounts = await hre.ethers.getSigners();

    operator = accounts[0];
    operator.name = 'operator';

    alice = accounts[1];
    alice.name = 'alice';

    bob = accounts[2];
    bob.name = 'bob';

    carol = accounts[3];
    carol.name = 'carol';

    contractsData = contracts;
    serviceContract = StakefishServicesContract.attach(contractsData[0].address);
  });

  it('Can deposit to a service contract', async function () {
    // check total deposits are 0
    let totalDeposits = await serviceContract.getTotalDeposits();
    expect(totalDeposits).to.equal(0);

    const res = await serviceContract.deposit({ value: eth(1) });
    expect(res).to.emit(serviceContract, 'Deposit').withArgs(accounts[0].address, eth(1));

    // check total deposits are 1
    totalDeposits = await serviceContract.getTotalDeposits();
    expect(totalDeposits).to.equal(eth(1));

    // deposit from different address
    const res2 = await serviceContract.connect(bob).deposit({ value: eth(5) });
    expect(res2).to.emit(serviceContract, 'Deposit').withArgs(bob.address, eth(5));

    // check total deposits are 6
    totalDeposits = await serviceContract.getTotalDeposits();
    expect(totalDeposits).to.equal(eth(6));

    // Check deposits are correctly split between addresses
    expect(await serviceContract.getDeposit(accounts[0].address)).to.equal(eth(1));
    expect(await serviceContract.getDeposit(bob.address)).to.equal(eth(5));

    // Check state is still depositing
    expect(await serviceContract.getState()).to.equal(State.PreDeposit);
  });

  it('Should refund any surplus deposits (above 32 ETH)', async function () {
    // check total deposits are 0
    let totalDeposits = await serviceContract.getTotalDeposits();
    expect(totalDeposits).to.equal(0);

    // Check state is pre-deposit
    expect(await serviceContract.getState()).to.equal(State.PreDeposit);

    let fullDeposit = eth(32);
    // deposit from different address
    const res = await serviceContract
      .connect(accounts[2])
      .deposit({ value: fullDeposit });
    expect(res)
      .to.emit(serviceContract, 'Deposit')
      .withArgs(accounts[2].address, fullDeposit);

    // check total deposits are 32
    totalDeposits = await serviceContract.getTotalDeposits();
    expect(totalDeposits).to.equal(fullDeposit);

    // current balance
    let balanceBefore = await ethers.provider.getBalance(carol.address);

    // deposit extra eth
    const res2 = await serviceContract
      .connect(carol)
      .deposit({ value: eth(6) });
    const receipt = await res2.wait(1);

    // check deposited amount is 0
    expect(res2)
      .to.emit(serviceContract, 'Deposit')
      .withArgs(carol.address, '0x0');

    let balanceAfter = await ethers.provider.getBalance(carol.address);

    // check balance (balanceBefore - gas)
    expect(balanceAfter).to.equal(balanceBefore.sub(receipt.gasUsed.mul(res2.gasPrice)));
  });

  it('Should allow the operator to create deposit and end the contract', async function() {
    const contractData = contractsData[0];

    let aliceDeposit = eth(20);
    let bobDeposit = eth(12);

    await serviceContract.connect(alice).deposit({ value: aliceDeposit });
    await serviceContract.connect(bob).deposit({ value: bobDeposit });

    await serviceContract.connect(operator).createValidator(
      operatorPubKeyBytes,
      contractData.depositData.depositSignature,
      contractData.depositData.depositDataRoot,
      exitDate
    );

    await operator.sendTransaction({ to: serviceContract.address, value: eth(40) });
    await serviceContract.connect(operator).endOperatorServices();
  });

  it('depositSize < 32 ETH - totalDeposits', async() => {
    const aliceDeposit = eth(20);
    const bobDeposit = eth(10);

    await verifyCallEffects({
      fromAccount: alice,
      call: 'deposit', value: aliceDeposit,
      verifiedUsers:                [alice],
      expectedDepositsBefore:       [eth(0)],
      expectedDepositsAfter:        [aliceDeposit],
      expectedETHDiffs:             [aliceDeposit],
      expectedContractETHBefore:    eth(0),
      expectedContractETHAfter:     aliceDeposit,
      expectedTotalDepositsBefore:  eth(0),
      expectedTotalDepositsAfter:   aliceDeposit
    });

    await verifyCallEffects({
      fromAccount: carol,
      call: 'depositOnBehalfOf', args: [bob.address], value: bobDeposit,
      verifiedUsers:                [bob, carol],
      expectedDepositsBefore:       [eth(0), eth(0)],
      expectedDepositsAfter:        [bobDeposit, eth(0)],
      expectedETHDiffs:             [eth(0), -bobDeposit],
      expectedContractETHDiff:      bobDeposit,
      expectedTotalDepositsDiff:    bobDeposit
    });
  });

  it('depositSize > 32 ETH - totalDeposits (deposit())', async() => {
    let aliceDeposit = eth(20);
    let bobDeposit = eth(15);
    let expectedAliceDeposit = eth(17); // and surplus = 3 ETH

    await serviceContract.connect(carol).depositOnBehalfOf(bob.address, { value: bobDeposit });

    await verifyCallEffects({
      fromAccount: alice,
      call: 'deposit', value: aliceDeposit,
      verifiedUsers:                [alice, bob],
      expectedDepositsBefore:       [eth(0), bobDeposit],
      expectedDepositsAfter:        [expectedAliceDeposit, bobDeposit],
      expectedETHDiffs:             [expectedAliceDeposit, eth(0)],
      expectedContractETHBefore:    bobDeposit,
      expectedContractETHAfter:     eth(32),
      expectedTotalDepositsBefore:  bobDeposit,
      expectedTotalDepositsAfter:   eth(32)
    });
  });

  it('depositSize > 32 ETH - totalDeposits (depositOnBehalfOf())', async() => {
    let aliceDeposit = eth(20);
    let bobDeposit = eth(15);
    let expectedBobDeposit = eth(12);
    let surplus = eth(3);

    await serviceContract.connect(alice).deposit({ value: aliceDeposit });

    await verifyCallEffects({
      fromAccount: carol,
      call: 'depositOnBehalfOf', args: [bob.address], value: bobDeposit,
      verifiedUsers:                [bob, carol],
      expectedDepositsBefore:       [eth(0), eth(0)],
      expectedDepositsAfter:        [expectedBobDeposit, eth(0)],
      expectedETHDiffs:             [surplus, -bobDeposit],
      expectedContractETHBefore:    aliceDeposit,
      expectedContractETHAfter:     eth(32),
      expectedTotalDepositsBefore:  aliceDeposit,
      expectedTotalDepositsAfter:   eth(32),
    });
  });

  it('depositSize > 32 ETH (deposit())', async() => {
    let aliceDeposit = eth(35);
    let expectedDeposit = eth(32);

    await verifyCallEffects({
      fromAccount: alice,
      call: 'deposit', value: aliceDeposit,
      verifiedUsers:                [alice],
      expectedDepositsBefore:       [eth(0)],
      expectedDepositsAfter:        [expectedDeposit],
      expectedETHDiffs:             [expectedDeposit],
      expectedContractETHBefore:    eth(0),
      expectedContractETHAfter:     expectedDeposit,
      expectedTotalDepositsBefore:  eth(0),
      expectedTotalDepositsAfter:   expectedDeposit
    });
  });

  it('depositSize > 32 ETH (depositOnBehalfOf())', async() => {
    let bobDeposit = eth(35);
    let expectedDeposit = eth(32);
    let surplus = eth(3);

    await verifyCallEffects({
      fromAccount: carol,
      call: 'depositOnBehalfOf', args: [bob.address], value: bobDeposit,
      verifiedUsers:                [bob, carol],
      expectedDepositsBefore:       [eth(0), eth(0)],
      expectedDepositsAfter:        [expectedDeposit, eth(0)],
      expectedETHDiffs:             [surplus, -bobDeposit],
      expectedContractETHBefore:    eth(0),
      expectedContractETHAfter:     expectedDeposit,
      expectedTotalDepositsBefore:  eth(0),
      expectedTotalDepositsAfter:   expectedDeposit
    });
  });

  it('deposit when contract\'s balance >= 32 ETH (deposit())', async() => {
    await serviceContract.connect(bob).deposit({ value: eth(32) });

    let aliceDeposit = eth(5);

    await verifyCallEffects({
      fromAccount: alice,
      call: 'deposit', value: aliceDeposit,
      verifiedUsers:                [alice],
      expectedDepositsBefore:       [eth(0)],
      expectedDepositsAfter:        [eth(0)],
      expectedETHDiffs:             [eth(0)],
      expectedContractETHDiff:      eth(0),
      expectedContractETHAfter:     eth(32),
      expectedTotalDepositsDiff:    eth(0),
    });
  });

  it('deposit when contract\'s balance >= 32 ETH (depositOnBehalfOf)', async() => {
    await serviceContract.connect(alice).deposit({ value: eth(32) });

    let bobDeposit = eth(5);

    await verifyCallEffects({
      fromAccount: carol,
      call: 'depositOnBehalfOf', args: [bob.address], value: bobDeposit,
      verifiedUsers:                [bob, carol],
      expectedDepositsBefore:       [eth(0), eth(0)],
      expectedDepositsAfter:        [eth(0), eth(0)],
      expectedETHDiffs:             [bobDeposit, -bobDeposit],
      expectedContractETHDiff:      eth(0),
      expectedTotalDepositsDiff:    eth(0)
    });
  });

  describe('With mock deposit contract', () => {
    before(async() => {
      const MockDepositContract = await hre.ethers.getContractFactory(
        'MockDepositContract'
      );

      let mockDepositoContract = await MockDepositContract.deploy();
      let mockDepositoContractCode =
        await ethers.provider.getCode(mockDepositoContract.address);

      await ethers.provider.send('hardhat_setCode', [
        DEPOSIT_CONTRACT_ADDRESS,
        mockDepositoContractCode,
      ]);
    });

    beforeEach(async() => {
      await ethers.provider.send('hardhat_setStorageAt', [
        DEPOSIT_CONTRACT_ADDRESS,
        '0x0',
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ]);
    });

    describe('Withdrawn state withdrawals, no commission', async() => {
      const aliceDeposit = eth(20);
      const bobDeposit = eth(12);

      const profit = eth(8);
      const aliceProfit = aliceDeposit.mul(profit).div(eth(32));
      const bobProfit = profit.sub(aliceProfit);

      beforeEach(async() => {
        const contractData = genContractData(100000, exitDate);
        await stakefishServicesContractFactory.changeCommissionRate(BigNumber.from(0));

        await stakefishServicesContractFactory.createContract(
          contractData.saltBytes,
          contractData.commitment
        );

        serviceContract = StakefishServicesContract.attach(contractData.address);

        await serviceContract.connect(alice).deposit({ value: aliceDeposit });
        await serviceContract.connect(carol).depositOnBehalfOf(bob.address, { value: bobDeposit });

        await serviceContract.connect(operator).createValidator(
          operatorPubKeyBytes,
          contractData.depositData.depositSignature,
          contractData.depositData.depositDataRoot,
          exitDate
        );

        await operator.sendTransaction({ to: serviceContract.address, value: eth(40), gasPrice: 0 });
        await serviceContract.connect(operator).endOperatorServices();
      });

      it('initial values', async() => {
        let state = await serviceContract.getState();
        assert.equal(state, State.Withdrawn, 'state should be Withdrawn');

        let balance = await ethers.provider.getBalance(serviceContract.address);
        assert.equal(balance.toString(), eth(40).toString(), 'balance should be 40 ETH');

        let totalDeposits = await serviceContract.getTotalDeposits();
        assert.equal(totalDeposits.toString(), eth(32).toString(), 'totalDeposits should be 32 ETH');
      });

      it('withdrawAll()', async() => {
        await verifyCallEffects({
          fromAccount: alice,
          call: 'withdrawAll',
          verifiedUsers:                  [alice],
          expectedDepositsBefore:         [aliceDeposit],
          expectedDepositsAfter:          [eth(0)],
          expectedDepositDiffs:           [-aliceDeposit],
          expectedETHDiffs:               [aliceDeposit.add(aliceProfit)],
          expectedContractETHBefore:      eth(40),
          expectedContractETHAfter:       eth(40).sub(aliceDeposit.add(aliceProfit)),
          expectedTotalDepositsBefore:    eth(32),
          expectedTotalDepositsAfter:     eth(32).sub(aliceDeposit)
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: 'withdrawAll',
          verifiedUsers:                  [bob],
          expectedDepositsBefore:         [bobDeposit],
          expectedDepositsAfter:          [eth(0)],
          expectedDepositDiffs:           [-bobDeposit],
          expectedETHDiffs:               [bobDeposit.add(bobProfit)],
          expectedContractETHAfter:       eth(0),
          expectedTotalDepositsAfter:     eth(0),
          expectedContractETHDiff:        -bobDeposit.add(bobProfit),
          expectedTotalDepositsDiff:      -bobDeposit
        });
      });

      it('withdraw() amount = deposit', async() => {
        await verifyCallEffects({
          fromAccount: alice,
          call: 'withdraw', args: [aliceDeposit],
          verifiedUsers:                  [alice],
          expectedDepositsBefore:         [aliceDeposit],
          expectedDepositsAfter:          [eth(0)],
          expectedDepositDiffs:           [-aliceDeposit],
          expectedETHDiffs:               [aliceDeposit.add(aliceProfit)],
          expectedContractETHBefore:      eth(40),
          expectedContractETHAfter:       eth(40).sub(aliceDeposit.add(aliceProfit)),
          expectedTotalDepositsBefore:    eth(32),
          expectedTotalDepositsAfter:     eth(32).sub(aliceDeposit)
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: 'withdraw', args: [bobDeposit],
          verifiedUsers:                  [bob],
          expectedDepositsBefore:         [bobDeposit],
          expectedDepositsAfter:          [eth(0)],
          expectedDepositDiffs:           [-bobDeposit],
          expectedETHDiffs:               [bobDeposit.add(bobProfit)],
          expectedContractETHAfter:       eth(0),
          expectedTotalDepositsAfter:     eth(0),
          expectedContractETHDiff:        -bobDeposit.add(bobProfit),
          expectedTotalDepositsDiff:      -bobDeposit
        });
      });

      it('withdraw() amount < deposit, 2 partial withdraws', async() => {
        let aliceWithdrawAmount = eth(8);
        let bobWithdrawAmount = eth(5);

        let alicePartialProfit = aliceWithdrawAmount.mul(profit).div(eth(32));
        let bobPartialProfit = bobWithdrawAmount.mul(profit).div(eth(32));

        await verifyCallEffects({
          fromAccount: alice,
          call: 'withdraw', args: [aliceWithdrawAmount],
          verifiedUsers:                  [alice],
          expectedDepositsBefore:         [aliceDeposit],
          expectedDepositsAfter:          [aliceDeposit.sub(aliceWithdrawAmount)],
          expectedDepositDiffs:           [-aliceWithdrawAmount],
          expectedETHDiffs:               [aliceWithdrawAmount.add(alicePartialProfit)],
          expectedContractETHDiff:        -aliceWithdrawAmount.add(alicePartialProfit),
          expectedTotalDepositsDiff:      -aliceWithdrawAmount
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: 'withdraw', args: [bobWithdrawAmount],
          verifiedUsers:                  [bob],
          expectedDepositsBefore:         [bobDeposit],
          expectedDepositsAfter:          [bobDeposit.sub(bobWithdrawAmount)],
          expectedDepositDiffs:           [-bobWithdrawAmount],
          expectedETHDiffs:               [bobWithdrawAmount.add(bobPartialProfit)],
          expectedContractETHDiff:        -bobWithdrawAmount.add(bobPartialProfit),
          expectedTotalDepositsDiff:      -bobWithdrawAmount,
        });

        aliceWithdrawAmount = aliceDeposit.sub(aliceWithdrawAmount);
        bobWithdrawAmount = bobDeposit.sub(bobWithdrawAmount);

        alicePartialProfit = aliceWithdrawAmount.mul(profit).div(eth(32));
        bobPartialProfit = bobWithdrawAmount.mul(profit).div(eth(32));

        await verifyCallEffects({
          fromAccount: alice,
          call: 'withdraw', args: [aliceWithdrawAmount],
          verifiedUsers:                  [alice],
          expectedDepositsAfter:          [eth(0)],
          expectedDepositDiffs:           [-aliceWithdrawAmount],
          expectedETHDiffs:               [aliceWithdrawAmount.add(alicePartialProfit)],
          expectedContractETHAfter:       bobWithdrawAmount.add(bobPartialProfit),
          expectedTotalDepositsAfter:     bobWithdrawAmount,
          expectedContractETHDiff:        -aliceWithdrawAmount.add(alicePartialProfit),
          expectedTotalDepositsDiff:      -aliceWithdrawAmount,
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: 'withdraw', args: [bobWithdrawAmount],
          verifiedUsers:                  [bob],
          expectedDepositsAfter:          [eth(0)],
          expectedDepositDiffs:           [-bobWithdrawAmount],
          expectedETHDiffs:               [bobWithdrawAmount.add(bobPartialProfit)],
          expectedContractETHAfter:       eth(0),
          expectedTotalDepositsAfter:     eth(0),
          expectedContractETHDiff:        -bobWithdrawAmount.add(bobPartialProfit),
          expectedTotalDepositsDiff:      -bobWithdrawAmount
        });
      });

      it('withdraw() amount > deposit', async() => {
        let aliceWithdrawAmount = aliceDeposit.add(eth(5));

        await verifyCallEffects({
          fromAccount: alice,
          call: 'withdraw', args: [aliceWithdrawAmount],
          verifiedUsers:                  [alice],
          expectedDepositsBefore:         [aliceDeposit],
          expectedDepositsAfter:          [aliceDeposit],
          expectedDepositDiffs:           [eth(0)],
          expectedContractETHBefore:      eth(40),
          expectedContractETHAfter:       eth(40),
          expectedTotalDepositsBefore:    eth(32),
          expectedTotalDepositsAfter:     eth(32),
          expectedContractETHDiff:        eth(0),
          expectedTotalDepositsDiff:      eth(0),
          revert: true
        });
      });

      it('withdrawTo', async() => {
        let aliceWithdrawAmount = eth(5);
        let alicePartialProfit = aliceWithdrawAmount.mul(profit).div(eth(32));

        await verifyCallEffects({
          fromAccount: alice,
          call: 'withdrawTo', args: [aliceWithdrawAmount, carol.address],
          verifiedUsers:                [alice, carol],
          expectedDepositsBefore:       [aliceDeposit, eth(0)],
          expectedDepositsAfter:        [aliceDeposit.sub(aliceWithdrawAmount), eth(0)],
          expectedETHDiffs:             [eth(0), aliceWithdrawAmount.add(alicePartialProfit)],
          expectedContractETHBefore:    eth(40),
          expectedContractETHAfter:     eth(40).sub(aliceWithdrawAmount.add(alicePartialProfit)),
          expectedTotalDepositsBefore:  eth(32),
          expectedTotalDepositsAfter:   eth(32).sub(aliceWithdrawAmount)
        });
      });

      it('withdrawFrom should pass if allowance >= withdrawal amount', async() => {
        let aliceWithdrawAmount = eth(5);
        let alicePartialProfit = aliceWithdrawAmount.mul(profit).div(eth(32));

        await verifyCallEffects({
          fromAccount: carol,
          call: 'withdrawFrom', args: [alice.address, bob.address, aliceWithdrawAmount],
          verifiedUsers:                [alice, bob, carol],
          expectedDepositsBefore:       [aliceDeposit, bobDeposit, eth(0)],
          expectedDepositsAfter:        [aliceDeposit.sub(aliceWithdrawAmount), bobDeposit, eth(0)],
          expectedETHDiffs:             [eth(0), aliceWithdrawAmount.add(alicePartialProfit), eth(0)],
          expectedContractETHDiff:      -aliceWithdrawAmount.add(alicePartialProfit),
          expectedTotalDepositsDiff:    -aliceWithdrawAmount,
          approval: { depositor: alice, spender: carol, amount: aliceWithdrawAmount },
          revert: false
        });
      });

      it('withdrawFrom should fail if allowance < withdrawal amount', async() => {
        let aliceWithdrawAmount = eth(5);
        aliceWithdrawAmount.mul(profit).div(eth(32));

        await verifyCallEffects({
          fromAccount: carol,
          call: 'withdrawFrom', args: [alice.address, bob.address, aliceWithdrawAmount],
          verifiedUsers:                [alice, bob, carol],
          expectedDepositsDiffs:        [eth(0), eth(0), eth(0)],
          expectedETHDiffs:             [eth(0), eth(0), eth(0)],
          expectedContractETHDiff:      eth(0),
          expectedTotalDepositsDiff:    eth(0),
          approval: { depositor: alice, spender: carol, amount: aliceWithdrawAmount.div(2) },
          revert: true
        });
      });

      it('allownce test', async() => {
        let aliceWithdrawAmount = eth(5);
        aliceWithdrawAmount.mul(profit).div(eth(32));
        let allowance = eth(7);
        let expectedAllowance = eth(2);

        await verifyCallEffects({
          fromAccount: carol,
          call: 'withdrawFrom', args: [alice.address, bob.address, aliceWithdrawAmount],
          approval: { depositor: alice, spender: carol, amount: allowance },
          revert: false
        });

        assert.equal(
          (await serviceContract.withdrawalAllowance(alice.address, carol.address)).toString(),
          expectedAllowance.toString(),
          'allowance error'
        );
      });
    });
  });
});