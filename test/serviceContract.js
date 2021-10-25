const hre = require('hardhat');
const { expect, assert } = require('chai');
const { keccak256 } = require('ethers/lib/utils');
const { ethers } = require('hardhat');
const { BigNumber } = ethers;
const { arrayify, zeroPad, parseEther } = ethers.utils;
const { randomBytes } = require('crypto');

async function getTxGasCost(txResponse) {
  const receipt = await txResponse.wait();
  return txResponse.gasPrice.mul(receipt.gasUsed);
}

function eth(num) {
  return parseEther(num.toString());
}

async function setNextBlockTimestamp (timestamp) {
  if (BigNumber.isBigNumber(timestamp))
    timestamp = timestamp.toNumber();
  return ethers.provider.send('evm_setNextBlockTimestamp', [timestamp]);
}

describe('Service contract tests', function () {
  let exitDate;

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
    event = { name: '', args: [] },
    reverted = false,
  }) {
    const callName = call.shift();
    let userBalancesBefore = await Promise.all(verifiedUsers.map(getUserBalances));
    let usersETHBefore = userBalancesBefore.map(data => data[0]);
    let usersDepositBefore = userBalancesBefore.map(data => data[1]);
    let contractETHBefore = await ethers.provider.getBalance(serviceContract.address);
    let totalDepositsBefore = await serviceContract.getTotalDeposits();

    if (expectedContractETHBefore !== undefined) {
      assert.equal(
        contractETHBefore.toString(),
        expectedContractETHBefore.toString(),
        `incorrect contract eth value before calling ${callName}`
      );
    }

    if (expectedTotalDepositsBefore !== undefined) {
      assert.equal(
        totalDepositsBefore.toString(),
        expectedTotalDepositsBefore.toString(),
        `incorrect totalDeposits before calling ${callName}`
      );
    }

    for (let i = 0; i < expectedDepositsBefore.length; ++i) {
      assert.equal(
        usersDepositBefore[i].toString(),
        expectedDepositsBefore[i].toString(),
        `incorrect deposit value before calling ${callName} for user ${verifiedUsers[i].name}`
      );
    }

    let txCost = eth(0);

    let connection = serviceContract.connect(fromAccount);
    let txResponsePromise = connection[callName].apply(connection, call);

    if (typeof reverted === 'string') {
      await expect(txResponsePromise).to.be.revertedWith(reverted);
    } else if (reverted === true) {
      await expect(txResponsePromise).to.be.reverted;
    } else {
      let txResponse = await txResponsePromise;
      txCost = await getTxGasCost(txResponse);
    }

    if (event.name != '') {
      if (event.args != []) {
        expect(await txResponsePromise).to.emit(serviceContract, event.name).withArgs(...event.args);
      }
      else {
        expect(await txResponsePromise).to.emit(serviceContract, event.name);
      }
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
        `incorrect deposit value after ${callName} for user ${verifiedUsers[i].name}`
      );
    }

    for (let i = 0; i < expectedDepositDiffs.length; ++i) {
      assert.equal(
        usersDepositAfter[i].sub(usersDepositBefore[i]).toString(),
        expectedDepositDiffs[i].toString(),
        `incorrect deposit diff for user ${verifiedUsers[i].name}`
      );
    }

    for (let i = 0; i < expectedETHDiffs.length; ++i) {
      if (verifiedUsers[i] == fromAccount) {
        continue;
      }
      assert.equal(
        usersETHAfter[i].sub(usersETHBefore[i]).toString(),
        expectedETHDiffs[i].toString(),
        `incorrect ETH diff for user ${verifiedUsers[i].name}: ${verifiedUsers[i]}`
      );
    }

    if (expectedETHDiffs.length > 0) {
      let idx = verifiedUsers.indexOf(fromAccount);
      if (idx > 0) {
        if (reverted) {
          assert.isBelow(
            usersETHAfter[idx],
            usersETHBefore[idx],
            `incorrect ETH diff for user ${fromAccount.name}`
          );
        } else {
          assert.equal(
            usersETHAfter[idx].sub(usersETHBefore[idx]).add(txCost).toString(),
            expectedETHDiffs[idx].toString(),
            `incorrect ETH diff for user ${fromAccount.name}`
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

  async function getUserBalances(user) {
    let balanceETH = await ethers.provider.getBalance(user.address);
    let balanceDeposit = await serviceContract.getDeposit(user.address);
    return [balanceETH, balanceDeposit];
  }

  async function approveWithdrawal(depositor, spender, amount) {
    let res = await serviceContract.connect(depositor).approveWithdrawal(
      spender,
      amount
    );

    expect(res).to.emit(serviceContract, 'WithdrawalApproval').withArgs(
      depositor.address,
      spender,
      amount
    );

    let withdrawalAllowance = await serviceContract.withdrawalAllowance(
      depositor.address,
      spender
    );

    assert.equal(
      withdrawalAllowance.toString(),
      amount.toString(),
      'withdrawalAllowance error'
    );
  }

  async function approveTransfer(depositor, spender, amount) {
    let res = await serviceContract.connect(depositor).approve(
      spender,
      amount
    );

    expect(res).to.emit(serviceContract, 'Approval').withArgs(
      depositor.address,
      spender,
      amount
    );

    let allowance = await serviceContract.getAllowance(
      depositor.address,
      spender
    );

    assert.equal(
      allowance.toString(),
      amount.toString(),
      'allowance error'
    );
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

    let newContractAddress = ethers.utils.getCreate2Address(
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
    // Can't use hardhat_reset because that breaks gas reporter
    // https://github.com/cgewecke/hardhat-gas-reporter/issues/62
    let blockNum = await ethers.provider.getBlockNumber();
    let timestamp = (await ethers.provider.getBlock(blockNum)).timestamp;
    exitDate = timestamp + 10000;

    StakefishServicesContractFactory = await hre.ethers.getContractFactory(
      'StakefishServicesContractFactory'
    );

    StakefishServicesContract = await hre.ethers.getContractFactory(
      'StakefishServicesContract'
    );

    stakefishServicesContractFactory =
      await StakefishServicesContractFactory.deploy(1000);

    await stakefishServicesContractFactory.deployed();

    // get template address
    let implAddress = await stakefishServicesContractFactory.getServicesContractImpl();

    // Standard bytecode for basic proxy contract for EIP-1167
    proxyInitCodeHash = keccak256(`0x3d602d80600a3d3981f3363d3d373d3d3d363d73${implAddress.substring(2)}5af43d82803e903d91602b57fd5bf3`);

    let contracts = [];
    let baseSaltValue = 0;
    let dataCommitments = [];

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

  it('createValidator() should emit ValidatorDeposited event', async function() {
    await serviceContract.connect(operator).deposit({ value: eth(32) });
    const contractData = contractsData[0];
    let res = await serviceContract.connect(operator).createValidator(
      operatorPubKeyBytes,
      contractData.depositData.depositSignature,
      contractData.depositData.depositDataRoot,
      exitDate
    );

    expect(res).to.emit(serviceContract, 'ValidatorDeposited').withArgs('0x' + Buffer.from(operatorPubKeyBytes).toString('hex'));
  });

  it('createValidator() should fail if state = Withdrawn', async function() {
    await serviceContract.connect(operator).deposit({ value: eth(32) });
    const contractData = contractsData[0];

    await serviceContract.connect(operator).createValidator(
      operatorPubKeyBytes,
      contractData.depositData.depositSignature,
      contractData.depositData.depositDataRoot,
      exitDate
    );

    // should be Validator has been created but hardhat...
    await expect(
      serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        contractData.depositData.depositSignature,
        contractData.depositData.depositDataRoot,
        exitDate
      )
    ).to.be.reverted;
  });

  it('createValidator() should fail if balance < 32 ETH', async function() {
    const contractData = contractsData[0];
    await expect(
      serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        contractData.depositData.depositSignature,
        contractData.depositData.depositDataRoot,
        exitDate
      )
    ).to.be.reverted;
  });

  it('createValidator() onlyOperator test', async function() {
    await serviceContract.connect(operator).deposit({ value: eth(32) });
    const contractData = contractsData[0];

    await expect(
      serviceContract.connect(alice).createValidator(
        operatorPubKeyBytes,
        contractData.depositData.depositSignature,
        contractData.depositData.depositDataRoot,
        exitDate
      )
    ).to.be.revertedWith('Caller is not the operator');
  });

  it('createValidator() with incorrect data should fail', async function() {
    await serviceContract.connect(operator).deposit({ value: eth(32) });
    const contractData = contractsData[0];

    await expect(
      serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes.slice(3),
        contractData.depositData.depositSignature,
        contractData.depositData.depositDataRoot,
        exitDate
      )
    ).to.be.revertedWith('Invalid validator public key');

    await expect(
      serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        contractData.depositData.depositSignature.slice(5),
        contractData.depositData.depositDataRoot,
        exitDate
      )
    ).to.be.revertedWith('Invalid deposit signature');

    await expect(
      serviceContract.connect(operator).createValidator(
        randomBytes(48),
        contractData.depositData.depositSignature,
        contractData.depositData.depositDataRoot,
        exitDate
      )
    ).to.be.revertedWith('Data doesn\'t match commitment');

    await expect(
      serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        randomBytes(96),
        contractData.depositData.depositDataRoot,
        exitDate
      )
    ).to.be.revertedWith('Data doesn\'t match commitment');

    await expect(
      serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        contractData.depositData.depositSignature,
        randomBytes(32),
        exitDate
      )
    ).to.be.revertedWith('Data doesn\'t match commitment');

    await expect(
      serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        contractData.depositData.depositSignature,
        contractData.depositData.depositDataRoot,
        exitDate + 5
      )
    ).to.be.revertedWith('Data doesn\'t match commitment');

    await expect(
      serviceContract.connect(operator).createValidator(
        Buffer.alloc(48, 0),
        contractData.depositData.depositSignature,
        contractData.depositData.depositDataRoot,
        exitDate
      )
    ).to.be.revertedWith('Data doesn\'t match commitment');

    await expect(
      serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        Buffer.alloc(96, 0),
        contractData.depositData.depositDataRoot,
        exitDate
      )
    ).to.be.revertedWith('Data doesn\'t match commitment');

    await expect(
      serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        contractData.depositData.depositSignature,
        Buffer.alloc(32, 0),
        exitDate
      )
    ).to.be.revertedWith('Data doesn\'t match commitment');

    await expect(
      serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        contractData.depositData.depositSignature,
        contractData.depositData.depositDataRoot,
        0
      )
    ).to.be.revertedWith('Data doesn\'t match commitment');
  });

  it('Should refund any surplus deposits (above 32 ETH)', async function () {
    // check total deposits are 0
    let totalDeposits = await serviceContract.getTotalDeposits();
    expect(totalDeposits).to.equal(0);

    // Check state is pre-deposit
    expect(await serviceContract.getState()).to.equal(State.PreDeposit);

    let fullDeposit = parseEther('32');
    // deposit from different address
    const res = await serviceContract
      .connect(alice)
      .deposit({ value: fullDeposit });
    expect(res)
      .to.emit(serviceContract, 'Deposit')
      .withArgs(alice.address, fullDeposit);

    // check total deposits are 32
    totalDeposits = await serviceContract.getTotalDeposits();
    expect(totalDeposits).to.equal(fullDeposit);

    const bobInitialBalance = await ethers.provider.getBalance(bob.address);

    // deposit extra eth
    const res2 = await serviceContract
      .connect(bob)
      .deposit({ value: eth(6) });

    // check deposited amount is 0
    expect(res2)
      .to.emit(serviceContract, 'Deposit')
      .withArgs(bob.address, '0x0');

    // get transaction receipt for gas usage
    const receipt = await res2.wait();
    const feePaid = receipt.gasUsed.mul(res2.gasPrice);

    const bobFinalBalance = await ethers.provider.getBalance(bob.address);

    expect(bobFinalBalance).to.equal(bobInitialBalance.sub(feePaid));
  });

  it('Calling endOperatorServices() in PreDeposit or Withdrawn state should fail', async function() {
    expect(await serviceContract.getState()).to.equal(State.PreDeposit);

    await expect(
      serviceContract.connect(operator).endOperatorServices()
    ).to.be.revertedWith('Can\'t end with 0 balance');

    await serviceContract.connect(operator).deposit({ value: eth(32) });

    await expect(
      serviceContract.connect(operator).endOperatorServices()
    ).to.be.revertedWith('Not allowed in the current state');

    const contractData = contractsData[0];
    await serviceContract.connect(operator).createValidator(
      operatorPubKeyBytes,
      contractData.depositData.depositSignature,
      contractData.depositData.depositDataRoot,
      exitDate
    );

    await operator.sendTransaction({ to: serviceContract.address, value: eth(40) });

    await setNextBlockTimestamp(exitDate);
    await serviceContract.connect(operator).endOperatorServices();

    expect(await serviceContract.getState()).to.equal(State.Withdrawn);

    await expect(
      serviceContract.connect(operator).endOperatorServices()
    ).to.be.revertedWith('Not allowed in the current state');
  });

  it('Calling endOperatorServices() from depositor', async function() {
    let blockNum = await ethers.provider.getBlockNumber();
    let timestamp = (await ethers.provider.getBlock(blockNum)).timestamp;
    let untilExitDate = exitDate - timestamp;
    assert.isAbove(untilExitDate, 0);

    await serviceContract.connect(alice).deposit({ value: eth(32) });

    const contractData = contractsData[0];
    await serviceContract.connect(operator).createValidator(
      operatorPubKeyBytes,
      contractData.depositData.depositSignature,
      contractData.depositData.depositDataRoot,
      exitDate
    );

    await operator.sendTransaction({ to: serviceContract.address, value: eth(40) });
    await expect(
      serviceContract.connect(alice).endOperatorServices()
    ).to.be.revertedWith('Not allowed at the current time');

    // increase time to exitDate + 1 year (MAX_SECONDS_IN_EXIT_QUEUE) + 1-2 days
    await hre.ethers.provider.send('evm_increaseTime', [untilExitDate + 367 * 24 * 60 * 60]);

    serviceContract.connect(alice).endOperatorServices();
    expect(await serviceContract.getState()).to.equal(State.Withdrawn);
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
    await setNextBlockTimestamp(exitDate);
    await serviceContract.connect(operator).endOperatorServices();
  });

  it('Deposits via direct transfer should revert', async function() {
    let aliceDeposit = eth(20);

    let depositBefore = await serviceContract.getDeposit(alice.address);
    expect(depositBefore).to.equal(0);

    await expect(alice.sendTransaction({ to: serviceContract.address, value: aliceDeposit}))
      .to.be.revertedWith('Plain Ether transfer not allowed');
  });

  it('depositSize < 32 ETH - totalDeposits', async() => {
    const aliceDeposit = eth(20);
    const bobDeposit = eth(10);

    await verifyCallEffects({
      fromAccount: alice,
      call: ['deposit', { value: aliceDeposit }],
      verifiedUsers:                [ alice        ],
      expectedDepositsBefore:       [ eth(0)       ],
      expectedDepositsAfter:        [ aliceDeposit ],
      expectedETHDiffs:             [ aliceDeposit ],
      expectedContractETHBefore:    eth(0),
      expectedContractETHAfter:     aliceDeposit,
      expectedTotalDepositsBefore:  eth(0),
      expectedTotalDepositsAfter:   aliceDeposit,
      event: { name: 'Deposit', args: [alice.address, aliceDeposit] }
    });

    await verifyCallEffects({
      fromAccount: carol,
      call: ['depositOnBehalfOf', bob.address, { value: bobDeposit }],
      verifiedUsers:                [ bob,        carol       ],
      expectedDepositsBefore:       [ eth(0),     eth(0)      ],
      expectedDepositsAfter:        [ bobDeposit, eth(0)      ],
      expectedETHDiffs:             [ eth(0),     -bobDeposit ],
      expectedContractETHDiff:      bobDeposit,
      expectedTotalDepositsDiff:    bobDeposit,
      event: { name: 'Deposit', args: [bob.address, bobDeposit] }
    });
  });

  it('depositSize > 32 ETH - totalDeposits (deposit())', async() => {
    let aliceDeposit = eth(20);
    let bobDeposit = eth(15);
    let expectedAliceDeposit = eth(17); // and surplus = 3 ETH

    await serviceContract.connect(carol).depositOnBehalfOf(bob.address, { value: bobDeposit });

    await verifyCallEffects({
      fromAccount: alice,
      call: ['deposit', { value: aliceDeposit }],
      verifiedUsers:                [ alice,                bob        ],
      expectedDepositsBefore:       [ eth(0),               bobDeposit ],
      expectedDepositsAfter:        [ expectedAliceDeposit, bobDeposit ],
      expectedETHDiffs:             [ expectedAliceDeposit, eth(0)     ],
      expectedContractETHBefore:    bobDeposit,
      expectedContractETHAfter:     eth(32),
      expectedTotalDepositsBefore:  bobDeposit,
      expectedTotalDepositsAfter:   eth(32),
      event: { name: 'Deposit', args: [alice.address, expectedAliceDeposit] }
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
      call: ['depositOnBehalfOf', bob.address, { value: bobDeposit }],
      verifiedUsers:                [ bob,                carol       ],
      expectedDepositsBefore:       [ eth(0),             eth(0)      ],
      expectedDepositsAfter:        [ expectedBobDeposit, eth(0)      ],
      expectedETHDiffs:             [ surplus,            -bobDeposit ],
      expectedContractETHBefore:    aliceDeposit,
      expectedContractETHAfter:     eth(32),
      expectedTotalDepositsBefore:  aliceDeposit,
      expectedTotalDepositsAfter:   eth(32),
      event: { name: 'Deposit', args: [bob.address, expectedBobDeposit] }
    });
  });

  it('depositSize > 32 ETH (deposit())', async() => {
    let aliceDeposit = eth(35);
    let expectedDeposit = eth(32);

    await verifyCallEffects({
      fromAccount: alice,
      call: ['deposit', { value: aliceDeposit }],
      verifiedUsers:                [ alice           ],
      expectedDepositsBefore:       [ eth(0)          ],
      expectedDepositsAfter:        [ expectedDeposit ],
      expectedETHDiffs:             [ expectedDeposit ],
      expectedContractETHBefore:    eth(0),
      expectedContractETHAfter:     expectedDeposit,
      expectedTotalDepositsBefore:  eth(0),
      expectedTotalDepositsAfter:   expectedDeposit,
      event: { name: 'Deposit', args: [alice.address, expectedDeposit] }
    });
  });

  it('depositSize > 32 ETH (depositOnBehalfOf())', async() => {
    let bobDeposit = eth(35);
    let expectedDeposit = eth(32);
    let surplus = eth(3);

    await verifyCallEffects({
      fromAccount: carol,
      call: ['depositOnBehalfOf', bob.address, { value: bobDeposit }],
      verifiedUsers:                [ bob,              carol       ],
      expectedDepositsBefore:       [ eth(0),           eth(0)      ],
      expectedDepositsAfter:        [ expectedDeposit,  eth(0)      ],
      expectedETHDiffs:             [ surplus,          -bobDeposit ],
      expectedContractETHBefore:    eth(0),
      expectedContractETHAfter:     expectedDeposit,
      expectedTotalDepositsBefore:  eth(0),
      expectedTotalDepositsAfter:   expectedDeposit,
      event: { name: 'Deposit', args: [bob.address, expectedDeposit] }
    });
  });

  it('deposit when contract\'s balance >= 32 ETH (deposit())', async() => {
    await serviceContract.connect(bob).deposit({ value: eth(32) });

    let aliceDeposit = eth(5);

    await verifyCallEffects({
      fromAccount: alice,
      call: ['deposit', { value: aliceDeposit }],
      verifiedUsers:                [ alice  ],
      expectedDepositsBefore:       [ eth(0) ],
      expectedDepositsAfter:        [ eth(0) ],
      expectedETHDiffs:             [ eth(0) ],
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
      call: ['depositOnBehalfOf', bob.address, { value: bobDeposit }],
      verifiedUsers:                [ bob,        carol       ],
      expectedDepositsBefore:       [ eth(0),     eth(0)      ],
      expectedDepositsAfter:        [ eth(0),     eth(0)      ],
      expectedETHDiffs:             [ bobDeposit, -bobDeposit ],
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

    describe('PreDeposit state withdrawals', async() => {
      const aliceDeposit = eth(10);
      const bobDeposit = eth(12);
      const expecedContractBalance = aliceDeposit.add(bobDeposit);

      beforeEach(async() => {
        const contractData = genContractData(100000, exitDate);

        await stakefishServicesContractFactory.createContract(
          contractData.saltBytes,
          contractData.commitment
        );

        serviceContract = StakefishServicesContract.attach(contractData.address);

        await serviceContract.connect(alice).deposit({ value: aliceDeposit });
        await serviceContract.connect(carol).depositOnBehalfOf(bob.address, { value: bobDeposit });
      });

      it('initial values', async() => {
        let state = await serviceContract.getState();
        assert.equal(state, State.PreDeposit, 'state should be PreDeposit');

        let balance = await ethers.provider.getBalance(serviceContract.address);
        let totalDeposits = await serviceContract.getTotalDeposits();

        assert.equal(balance.toString(), totalDeposits.toString(), 'balance should be equal to totalDeposits');
      });

      it('withdrawAll()', async() => {
        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdrawAll'],
          verifiedUsers:                [ alice         ],
          expectedDepositsBefore:       [ aliceDeposit  ],
          expectedDepositsAfter:        [ eth(0)        ],
          expectedDepositDiffs:         [ -aliceDeposit ],
          expectedETHDiffs:             [ aliceDeposit  ],
          expectedContractETHBefore:    expecedContractBalance,
          expectedContractETHAfter:     expecedContractBalance.sub(aliceDeposit),
          expectedTotalDepositsBefore:  expecedContractBalance,
          expectedTotalDepositsAfter:   expecedContractBalance.sub(aliceDeposit),
          event: { name: 'Withdrawal', args: [alice.address, alice.address, aliceDeposit, aliceDeposit] }
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: ['withdrawAll'],
          verifiedUsers:                  [ bob         ],
          expectedDepositsBefore:         [ bobDeposit  ],
          expectedDepositsAfter:          [ eth(0)      ],
          expectedDepositDiffs:           [ -bobDeposit ],
          expectedETHDiffs:               [ bobDeposit  ],
          expectedContractETHAfter:       eth(0),
          expectedTotalDepositsAfter:     eth(0),
          expectedContractETHDiff:        -bobDeposit,
          expectedTotalDepositsDiff:      -bobDeposit,
          event: { name: 'Withdrawal', args: [bob.address, bob.address, bobDeposit, bobDeposit] }
        });
      });

      it('withdraw() amount < deposit, 2 partial withdraws', async() => {
        let aliceWithdrawAmount = eth(8);
        let bobWithdrawAmount = eth(5);

        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdraw', aliceWithdrawAmount],
          verifiedUsers:                  [ alice                                 ],
          expectedDepositsBefore:         [ aliceDeposit                          ],
          expectedDepositsAfter:          [ aliceDeposit.sub(aliceWithdrawAmount) ],
          expectedDepositDiffs:           [ -aliceWithdrawAmount                  ],
          expectedETHDiffs:               [ aliceWithdrawAmount                   ],
          expectedContractETHDiff:        -aliceWithdrawAmount,
          expectedTotalDepositsDiff:      -aliceWithdrawAmount
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: ['withdraw', bobWithdrawAmount],
          verifiedUsers:                  [ bob                               ],
          expectedDepositsBefore:         [ bobDeposit                        ],
          expectedDepositsAfter:          [ bobDeposit.sub(bobWithdrawAmount) ],
          expectedDepositDiffs:           [ -bobWithdrawAmount                ],
          expectedETHDiffs:               [ bobWithdrawAmount                 ],
          expectedContractETHDiff:        -bobWithdrawAmount,
          expectedTotalDepositsDiff:      -bobWithdrawAmount,
        });

        aliceWithdrawAmount = aliceDeposit.sub(aliceWithdrawAmount);
        bobWithdrawAmount = bobDeposit.sub(bobWithdrawAmount);

        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdraw', aliceWithdrawAmount],
          verifiedUsers:                  [ alice                ],
          expectedDepositsAfter:          [ eth(0)               ],
          expectedDepositDiffs:           [ -aliceWithdrawAmount ],
          expectedETHDiffs:               [ aliceWithdrawAmount  ],
          expectedContractETHAfter:       bobWithdrawAmount,
          expectedTotalDepositsAfter:     bobWithdrawAmount,
          expectedContractETHDiff:        -aliceWithdrawAmount,
          expectedTotalDepositsDiff:      -aliceWithdrawAmount,
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: ['withdraw', bobWithdrawAmount],
          verifiedUsers:                  [ bob                ],
          expectedDepositsAfter:          [ eth(0)             ],
          expectedDepositDiffs:           [ -bobWithdrawAmount ],
          expectedETHDiffs:               [ bobWithdrawAmount  ],
          expectedContractETHAfter:       eth(0),
          expectedTotalDepositsAfter:     eth(0),
          expectedContractETHDiff:        -bobWithdrawAmount,
          expectedTotalDepositsDiff:      -bobWithdrawAmount
        });
      });

      it('withdraw() amount > deposit', async() => {
        let aliceWithdrawAmount = aliceDeposit.add(eth(5));

        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdraw', aliceWithdrawAmount],
          verifiedUsers:                  [ alice        ],
          expectedDepositsBefore:         [ aliceDeposit ],
          expectedDepositsAfter:          [ aliceDeposit ],
          expectedDepositDiffs:           [ eth(0)       ],
          expectedContractETHBefore:      expecedContractBalance,
          expectedContractETHAfter:       expecedContractBalance,
          expectedTotalDepositsBefore:    expecedContractBalance,
          expectedTotalDepositsAfter:     expecedContractBalance,
          expectedContractETHDiff:        eth(0),
          expectedTotalDepositsDiff:      eth(0),
          reverted: true
        });
      });

      it('withdrawTo', async() => {
        let aliceWithdrawAmount = eth(5);

        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdrawTo', aliceWithdrawAmount, carol.address],
          verifiedUsers:                [ alice,                                  carol               ],
          expectedDepositsBefore:       [ aliceDeposit,                           eth(0)              ],
          expectedDepositsAfter:        [ aliceDeposit.sub(aliceWithdrawAmount),  eth(0)              ],
          expectedETHDiffs:             [ eth(0),                                 aliceWithdrawAmount ],
          expectedContractETHBefore:    expecedContractBalance,
          expectedContractETHAfter:     expecedContractBalance.sub(aliceWithdrawAmount),
          expectedTotalDepositsBefore:  expecedContractBalance,
          expectedTotalDepositsAfter:   expecedContractBalance.sub(aliceWithdrawAmount),
          event: { name: 'Withdrawal', args: [alice.address, carol.address, aliceWithdrawAmount, aliceWithdrawAmount] }
        });
      });

      it('withdrawFrom should pass if allowance >= withdrawal amount', async() => {
        let aliceWithdrawAmount = eth(5);

        await approveWithdrawal(alice, carol.address, aliceWithdrawAmount);
        await verifyCallEffects({
          fromAccount: carol,
          call: ['withdrawFrom', alice.address, bob.address, aliceWithdrawAmount],
          verifiedUsers:                [ alice,                                  bob,                  carol  ],
          expectedDepositsBefore:       [ aliceDeposit,                           bobDeposit,           eth(0) ],
          expectedDepositsAfter:        [ aliceDeposit.sub(aliceWithdrawAmount),  bobDeposit,           eth(0) ],
          expectedETHDiffs:             [ eth(0),                                 aliceWithdrawAmount,  eth(0) ],
          expectedContractETHDiff:      -aliceWithdrawAmount,
          expectedTotalDepositsDiff:    -aliceWithdrawAmount,
          event: { name: 'Withdrawal', args: [alice.address, bob.address, aliceWithdrawAmount, aliceWithdrawAmount] }
        });
      });

      it('withdrawFrom should fail if allowance < withdrawal amount', async() => {
        let aliceWithdrawAmount = eth(5);

        await approveWithdrawal(alice, carol.address, aliceWithdrawAmount.div(2));
        await verifyCallEffects({
          fromAccount: carol,
          call: ['withdrawFrom', alice.address, bob.address, aliceWithdrawAmount],
          verifiedUsers:              [ alice,  bob,    carol  ],
          expectedDepositsDiffs:      [ eth(0), eth(0), eth(0) ],
          expectedETHDiffs:           [ eth(0), eth(0), eth(0) ],
          expectedContractETHDiff:    eth(0),
          expectedTotalDepositsDiff:  eth(0),
          reverted: true
        });
      });
    });

    describe('Deposits and withdrawals in PostDeposit state', async() => {
      const aliceDeposit = eth(20);
      const bobDeposit = eth(12);

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
      });

      it('initial values', async() => {
        let state = await serviceContract.getState();
        assert.equal(state, State.PostDeposit, 'state should be PostDeposit');

        let balance = await ethers.provider.getBalance(serviceContract.address);
        assert.equal(balance.toString(), eth(0).toString(), 'balance should be 0 ETH');

        let totalDeposits = await serviceContract.getTotalDeposits();
        assert.equal(totalDeposits.toString(), eth(32).toString(), 'totalDeposits should be 32 ETH');
      });

      it('deposits should fail', async() => {
        await expect(
          serviceContract.connect(alice).deposit({ value: aliceDeposit })
        ).to.be.revertedWith('Validator already created');

        await expect(
          serviceContract.connect(carol).depositOnBehalfOf(bob.address, { value: bobDeposit })
        ).to.be.revertedWith('Validator already created');
      });

      it('withdrawals should fail', async() => {
        await expect(
          serviceContract.connect(alice).withdrawAll()
        ).to.be.revertedWith('Not allowed when validator is active');

        await expect(
          serviceContract.connect(bob).withdrawAll()
        ).to.be.revertedWith('Not allowed when validator is active');

        await expect(
          serviceContract.connect(alice).withdraw(aliceDeposit)
        ).to.be.revertedWith('Not allowed when validator is active');

        await expect(
          serviceContract.connect(bob).withdraw(bobDeposit)
        ).to.be.revertedWith('Not allowed when validator is active');

        await expect(
          serviceContract.connect(alice).withdrawTo(aliceDeposit, carol.address)
        ).to.be.revertedWith('Not allowed when validator is active');

        await expect(
          serviceContract.connect(bob).withdrawTo(bobDeposit, carol.address)
        ).to.be.revertedWith('Not allowed when validator is active');

        await serviceContract.connect(alice).approveWithdrawal(carol.address, aliceDeposit);
        await serviceContract.connect(bob).approveWithdrawal(carol.address, bobDeposit);

        await expect(
          serviceContract.connect(carol).withdrawFrom(alice.address, bob.address, aliceDeposit)
        ).to.be.revertedWith('Not allowed when validator is active');

        await expect(
          serviceContract.connect(carol).withdrawFrom(bob.address, alice.address, bobDeposit)
        ).to.be.revertedWith('Not allowed when validator is active');
      });
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
        await setNextBlockTimestamp(exitDate);
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
          call: ['withdrawAll'],
          verifiedUsers:                  [ alice                         ],
          expectedDepositsBefore:         [ aliceDeposit                  ],
          expectedDepositsAfter:          [ eth(0)                        ],
          expectedDepositDiffs:           [ -aliceDeposit                 ],
          expectedETHDiffs:               [ aliceDeposit.add(aliceProfit) ],
          expectedContractETHBefore:      eth(40),
          expectedContractETHAfter:       eth(40).sub(aliceDeposit.add(aliceProfit)),
          expectedTotalDepositsBefore:    eth(32),
          expectedTotalDepositsAfter:     eth(32).sub(aliceDeposit),
          event: { name: 'Withdrawal', args: [alice.address, alice.address, aliceDeposit, aliceDeposit.add(aliceProfit)] }
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: ['withdrawAll'],
          verifiedUsers:                  [ bob                       ],
          expectedDepositsBefore:         [ bobDeposit                ],
          expectedDepositsAfter:          [ eth(0)                    ],
          expectedDepositDiffs:           [ -bobDeposit               ],
          expectedETHDiffs:               [ bobDeposit.add(bobProfit) ],
          expectedContractETHAfter:       eth(0),
          expectedTotalDepositsAfter:     eth(0),
          expectedContractETHDiff:        -bobDeposit.add(bobProfit),
          expectedTotalDepositsDiff:      -bobDeposit,
          event: { name: 'Withdrawal', args: [bob.address, bob.address, bobDeposit, bobDeposit.add(bobProfit)] }
        });
      });

      it('withdraw() amount = deposit', async() => {
        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdraw', aliceDeposit],
          verifiedUsers:                  [ alice                         ],
          expectedDepositsBefore:         [ aliceDeposit                  ],
          expectedDepositsAfter:          [ eth(0)                        ],
          expectedDepositDiffs:           [ -aliceDeposit                 ],
          expectedETHDiffs:               [ aliceDeposit.add(aliceProfit) ],
          expectedContractETHBefore:      eth(40),
          expectedContractETHAfter:       eth(40).sub(aliceDeposit.add(aliceProfit)),
          expectedTotalDepositsBefore:    eth(32),
          expectedTotalDepositsAfter:     eth(32).sub(aliceDeposit)
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: ['withdraw', bobDeposit],
          verifiedUsers:                  [ bob                       ],
          expectedDepositsBefore:         [ bobDeposit                ],
          expectedDepositsAfter:          [ eth(0)                    ],
          expectedDepositDiffs:           [ -bobDeposit               ],
          expectedETHDiffs:               [ bobDeposit.add(bobProfit) ],
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
          call: ['withdraw', aliceWithdrawAmount],
          verifiedUsers:                  [ alice                                       ],
          expectedDepositsBefore:         [ aliceDeposit                                ],
          expectedDepositsAfter:          [ aliceDeposit.sub(aliceWithdrawAmount)       ],
          expectedDepositDiffs:           [ -aliceWithdrawAmount                        ],
          expectedETHDiffs:               [ aliceWithdrawAmount.add(alicePartialProfit) ],
          expectedContractETHDiff:        -aliceWithdrawAmount.add(alicePartialProfit),
          expectedTotalDepositsDiff:      -aliceWithdrawAmount,
          event: { name: 'Withdrawal', args: [alice.address, alice.address, aliceWithdrawAmount, aliceWithdrawAmount.add(alicePartialProfit)] }
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: ['withdraw', bobWithdrawAmount],
          verifiedUsers:                  [ bob                                     ],
          expectedDepositsBefore:         [ bobDeposit                              ],
          expectedDepositsAfter:          [ bobDeposit.sub(bobWithdrawAmount)       ],
          expectedDepositDiffs:           [ -bobWithdrawAmount                      ],
          expectedETHDiffs:               [ bobWithdrawAmount.add(bobPartialProfit) ],
          expectedContractETHDiff:        -bobWithdrawAmount.add(bobPartialProfit),
          expectedTotalDepositsDiff:      -bobWithdrawAmount,
        });

        aliceWithdrawAmount = aliceDeposit.sub(aliceWithdrawAmount);
        bobWithdrawAmount = bobDeposit.sub(bobWithdrawAmount);

        alicePartialProfit = aliceWithdrawAmount.mul(profit).div(eth(32));
        bobPartialProfit = bobWithdrawAmount.mul(profit).div(eth(32));

        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdraw', aliceWithdrawAmount],
          verifiedUsers:                  [ alice                                       ],
          expectedDepositsAfter:          [ eth(0)                                      ],
          expectedDepositDiffs:           [ -aliceWithdrawAmount                        ],
          expectedETHDiffs:               [ aliceWithdrawAmount.add(alicePartialProfit) ],
          expectedContractETHAfter:       bobWithdrawAmount.add(bobPartialProfit),
          expectedTotalDepositsAfter:     bobWithdrawAmount,
          expectedContractETHDiff:        -aliceWithdrawAmount.add(alicePartialProfit),
          expectedTotalDepositsDiff:      -aliceWithdrawAmount,
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: ['withdraw', bobWithdrawAmount],
          verifiedUsers:                  [ bob                                     ],
          expectedDepositsAfter:          [ eth(0)                                  ],
          expectedDepositDiffs:           [ -bobWithdrawAmount                      ],
          expectedETHDiffs:               [ bobWithdrawAmount.add(bobPartialProfit) ],
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
          call: ['withdraw', aliceWithdrawAmount],
          verifiedUsers:                  [ alice        ],
          expectedDepositsBefore:         [ aliceDeposit ],
          expectedDepositsAfter:          [ aliceDeposit ],
          expectedDepositDiffs:           [ eth(0)       ],
          expectedContractETHBefore:      eth(40),
          expectedContractETHAfter:       eth(40),
          expectedTotalDepositsBefore:    eth(32),
          expectedTotalDepositsAfter:     eth(32),
          expectedContractETHDiff:        eth(0),
          expectedTotalDepositsDiff:      eth(0),
          reverted: true
        });
      });

      it('withdrawTo', async() => {
        let aliceWithdrawAmount = eth(5);
        let alicePartialProfit = aliceWithdrawAmount.mul(profit).div(eth(32));

        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdrawTo', aliceWithdrawAmount, carol.address],
          verifiedUsers:                  [ alice, carol                                        ],
          expectedDepositsBefore:         [ aliceDeposit, eth(0)                                ],
          expectedDepositsAfter:          [ aliceDeposit.sub(aliceWithdrawAmount), eth(0)       ],
          expectedETHDiffs:               [ eth(0), aliceWithdrawAmount.add(alicePartialProfit) ],
          expectedContractETHBefore:      eth(40),
          expectedContractETHAfter:       eth(40).sub(aliceWithdrawAmount.add(alicePartialProfit)),
          expectedTotalDepositsBefore:    eth(32),
          expectedTotalDepositsAfter:     eth(32).sub(aliceWithdrawAmount),
          event: { name: 'Withdrawal', args: [alice.address, carol.address, aliceWithdrawAmount, aliceWithdrawAmount.add(alicePartialProfit)] }
        });
      });

      it('withdrawFrom should pass if allowance >= withdrawal amount', async() => {
        let aliceWithdrawAmount = eth(5);
        let alicePartialProfit = aliceWithdrawAmount.mul(profit).div(eth(32));
        let finalWithdrawnValue = aliceWithdrawAmount.add(alicePartialProfit);

        await approveWithdrawal(alice, carol.address, aliceWithdrawAmount);
        await verifyCallEffects({
          fromAccount: carol,
          call: ['withdrawFrom', alice.address, bob.address, aliceWithdrawAmount],
          verifiedUsers:                  [ alice,                                  bob,                  carol  ],
          expectedDepositsBefore:         [ aliceDeposit,                           bobDeposit,           eth(0) ],
          expectedDepositsAfter:          [ aliceDeposit.sub(aliceWithdrawAmount),  bobDeposit,           eth(0) ],
          expectedETHDiffs:               [ eth(0),                                 finalWithdrawnValue,  eth(0) ],
          expectedContractETHDiff:        -finalWithdrawnValue,
          expectedTotalDepositsDiff:      -aliceWithdrawAmount,
          event: { name: 'Withdrawal', args: [alice.address, bob.address, aliceWithdrawAmount, finalWithdrawnValue] }
        });
      });

      it('withdrawFrom should fail if allowance < withdrawal amount', async() => {
        let aliceWithdrawAmount = eth(5);

        await approveWithdrawal(alice, carol.address, aliceWithdrawAmount.div(2));
        await verifyCallEffects({
          fromAccount: carol,
          call: ['withdrawFrom', alice.address, bob.address, aliceWithdrawAmount],
          verifiedUsers:                  [ alice,  bob,    carol  ],
          expectedDepositsDiffs:          [ eth(0), eth(0), eth(0) ],
          expectedETHDiffs:               [ eth(0), eth(0), eth(0) ],
          expectedContractETHDiff:        eth(0),
          expectedTotalDepositsDiff:      eth(0),
          reverted: true
        });
      });

      it('allowance test', async() => {
        let aliceWithdrawAmount = eth(5);
        let allowance = eth(7);
        let expectedAllowance = eth(2);

        await approveWithdrawal(alice, carol.address, allowance);
        await serviceContract.connect(carol).withdrawFrom(alice.address, bob.address, aliceWithdrawAmount);
        // TODO
        /*
        await verifyCallEffects({
          fromAccount:    carol,
          call:           "withdrawFrom",
          args:           [ alice.address, bob.address, aliceWithdrawAmount ]
        });
        */

        assert.equal(
          (await serviceContract.withdrawalAllowance(alice.address, carol.address)).toString(),
          expectedAllowance.toString(),
          'allowance error'
        );
      });
    });

    describe('Withdrawn state withdrawals, commission > 0', async() => {
      const aliceDeposit = eth(20);
      const bobDeposit = eth(12);

      const profit = eth(8);
      const commissionRate = BigNumber.from(20000);  // 2% (COMMISSION_RATE_SCALE = 1000000)
      const commission = commissionRate.mul(profit).div(1000000);
      const finalProfit = profit.sub(commission);

      const aliceProfit = aliceDeposit.mul(finalProfit).div(eth(32));
      const bobProfit = bobDeposit.mul(finalProfit).div(eth(32));

      beforeEach(async() => {
        const contractData = genContractData(100000, exitDate);
        await stakefishServicesContractFactory.changeCommissionRate(commissionRate);

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
      });

      it('Commission should not be transfered to operator\'s account directly, ServiceEnd event should be emitted', async() => {
        let ETHBalanceBefore = await ethers.provider.getBalance(operator.address);

        await setNextBlockTimestamp(exitDate);
        let res = await serviceContract.connect(operator).endOperatorServices();

        let ETHBalanceAfterEnd = await ethers.provider.getBalance(operator.address);
        let txCost = await getTxGasCost(res);

        expect(res).to.emit(serviceContract, 'ServiceEnd');
        expect(ETHBalanceAfterEnd).to.equal(ETHBalanceBefore.sub(txCost));
        expect(await serviceContract.getOperatorClaimable()).to.be.equal(commission);

        res = await serviceContract.connect(operator).operatorClaim();
        expect(res).to.emit(serviceContract, 'Claim').withArgs(operator.address, commission);

        txCost = await getTxGasCost(res);
        let ETHBalanceAfterClaim = await ethers.provider.getBalance(operator.address);

        expect(ETHBalanceAfterClaim).to.be.equal(ETHBalanceAfterEnd.sub(txCost).add(commission));
      });

      it('withdrawAll()', async() => {
        await setNextBlockTimestamp(exitDate);
        await serviceContract.connect(operator).endOperatorServices();
        await serviceContract.connect(operator).operatorClaim();

        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdrawAll'],
          verifiedUsers:                  [ alice                         ],
          expectedDepositsBefore:         [ aliceDeposit                  ],
          expectedDepositsAfter:          [ eth(0)                        ],
          expectedDepositDiffs:           [ -aliceDeposit                 ],
          expectedETHDiffs:               [ aliceDeposit.add(aliceProfit) ],
          expectedContractETHBefore:      eth(40).sub(commission),
          expectedContractETHAfter:       eth(40).sub(commission).sub(aliceDeposit.add(aliceProfit)),
          expectedTotalDepositsBefore:    eth(32),
          expectedTotalDepositsAfter:     eth(32).sub(aliceDeposit)
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: ['withdrawAll'],
          verifiedUsers:                  [ bob                       ],
          expectedDepositsBefore:         [ bobDeposit                ],
          expectedDepositsAfter:          [ eth(0)                    ],
          expectedDepositDiffs:           [ -bobDeposit               ],
          expectedETHDiffs:               [ bobDeposit.add(bobProfit) ],
          expectedContractETHAfter:       eth(0),
          expectedTotalDepositsAfter:     eth(0),
          expectedContractETHDiff:        -bobDeposit.add(bobProfit),
          expectedTotalDepositsDiff:      -bobDeposit
        });
      });

      it('withdraw() amount < deposit, 2 partial withdraws', async() => {
        let aliceWithdrawAmount = eth(8);
        let bobWithdrawAmount = eth(5);

        let alicePartialProfit = aliceWithdrawAmount.mul(finalProfit).div(eth(32));
        let bobPartialProfit = bobWithdrawAmount.mul(finalProfit).div(eth(32));

        await setNextBlockTimestamp(exitDate);
        await serviceContract.connect(operator).endOperatorServices();
        await serviceContract.connect(operator).operatorClaim();

        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdraw', aliceWithdrawAmount],
          verifiedUsers:                  [ alice                                       ],
          expectedDepositsBefore:         [ aliceDeposit                                ],
          expectedDepositsAfter:          [ aliceDeposit.sub(aliceWithdrawAmount)       ],
          expectedDepositDiffs:           [ -aliceWithdrawAmount                        ],
          expectedETHDiffs:               [ aliceWithdrawAmount.add(alicePartialProfit) ],
          expectedContractETHDiff:        -aliceWithdrawAmount.add(alicePartialProfit),
          expectedTotalDepositsDiff:      -aliceWithdrawAmount
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: ['withdraw', bobWithdrawAmount],
          verifiedUsers:                  [ bob                                     ],
          expectedDepositsBefore:         [ bobDeposit                              ],
          expectedDepositsAfter:          [ bobDeposit.sub(bobWithdrawAmount)       ],
          expectedDepositDiffs:           [ -bobWithdrawAmount                      ],
          expectedETHDiffs:               [ bobWithdrawAmount.add(bobPartialProfit) ],
          expectedContractETHDiff:        -bobWithdrawAmount.add(bobPartialProfit),
          expectedTotalDepositsDiff:      -bobWithdrawAmount,
        });

        aliceWithdrawAmount = aliceDeposit.sub(aliceWithdrawAmount);
        bobWithdrawAmount = bobDeposit.sub(bobWithdrawAmount);

        alicePartialProfit = aliceWithdrawAmount.mul(finalProfit).div(eth(32));
        bobPartialProfit = bobWithdrawAmount.mul(finalProfit).div(eth(32));

        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdraw', aliceWithdrawAmount],
          verifiedUsers:                  [ alice                                       ],
          expectedDepositsAfter:          [ eth(0)                                      ],
          expectedDepositDiffs:           [ -aliceWithdrawAmount                        ],
          expectedETHDiffs:               [ aliceWithdrawAmount.add(alicePartialProfit) ],
          expectedContractETHAfter:       bobWithdrawAmount.add(bobPartialProfit),
          expectedTotalDepositsAfter:     bobWithdrawAmount,
          expectedContractETHDiff:        -aliceWithdrawAmount.add(alicePartialProfit),
          expectedTotalDepositsDiff:      -aliceWithdrawAmount,
        });

        await verifyCallEffects({
          fromAccount: bob,
          call: ['withdraw', bobWithdrawAmount],
          verifiedUsers:                  [ bob                                     ],
          expectedDepositsAfter:          [ eth(0)                                  ],
          expectedDepositDiffs:           [ -bobWithdrawAmount                      ],
          expectedETHDiffs:               [ bobWithdrawAmount.add(bobPartialProfit) ],
          expectedContractETHAfter:       eth(0),
          expectedTotalDepositsAfter:     eth(0),
          expectedContractETHDiff:        -bobWithdrawAmount.add(bobPartialProfit),
          expectedTotalDepositsDiff:      -bobWithdrawAmount
        });
      });

      it('withdrawTo', async() => {
        let aliceWithdrawAmount = eth(5);
        let alicePartialProfit = aliceWithdrawAmount.mul(finalProfit).div(eth(32));
        let finalWithdrawnValue = aliceWithdrawAmount.add(alicePartialProfit);

        await setNextBlockTimestamp(exitDate);
        await serviceContract.connect(operator).endOperatorServices();
        await serviceContract.connect(operator).operatorClaim();

        await verifyCallEffects({
          fromAccount: alice,
          call: ['withdrawTo', aliceWithdrawAmount, carol.address],
          verifiedUsers:                  [ alice,                                  carol               ],
          expectedDepositsBefore:         [ aliceDeposit,                           eth(0)              ],
          expectedDepositsAfter:          [ aliceDeposit.sub(aliceWithdrawAmount),  eth(0)              ],
          expectedETHDiffs:               [ eth(0),                                 finalWithdrawnValue ],
          expectedContractETHBefore:      eth(40).sub(commission),
          expectedContractETHAfter:       eth(40).sub(commission).sub(finalWithdrawnValue),
          expectedTotalDepositsBefore:    eth(32),
          expectedTotalDepositsAfter:     eth(32).sub(aliceWithdrawAmount)
        });
      });

      it('withdrawFrom should pass if allowance >= withdrawal amount', async() => {
        let aliceWithdrawAmount = eth(5);
        let alicePartialProfit = aliceWithdrawAmount.mul(finalProfit).div(eth(32));
        let finalWithdrawnValue = aliceWithdrawAmount.add(alicePartialProfit);

        await setNextBlockTimestamp(exitDate);
        await serviceContract.connect(operator).endOperatorServices();
        await serviceContract.connect(operator).operatorClaim();

        await approveWithdrawal(alice, carol.address, aliceWithdrawAmount);
        await verifyCallEffects({
          fromAccount: carol,
          call: ['withdrawFrom', alice.address, bob.address, aliceWithdrawAmount],
          verifiedUsers:                  [ alice,                                  bob,                  carol  ],
          expectedDepositsBefore:         [ aliceDeposit,                           bobDeposit,           eth(0) ],
          expectedDepositsAfter:          [ aliceDeposit.sub(aliceWithdrawAmount),  bobDeposit,           eth(0) ],
          expectedETHDiffs:               [ eth(0),                                 finalWithdrawnValue,  eth(0) ],
          expectedContractETHDiff:        -finalWithdrawnValue,
          expectedTotalDepositsDiff:      -aliceWithdrawAmount,
        });
      });
    });
  });

  describe('Transfer tests in PreDeposit', async() => {
    const aliceDeposit = eth(20);

    beforeEach(async() => {
      await serviceContract.connect(alice).deposit({ value: aliceDeposit });
      expect(await serviceContract.getState()).to.equal(State.PreDeposit);
    });

    it('transfer with amount < user\'s deposit', async() => {
      await verifyCallEffects({
        fromAccount: alice,
        call: ['transferDeposit', bob.address, aliceDeposit],
        verifiedUsers:                    [ alice,        bob          ],
        expectedDepositsBefore:           [ aliceDeposit, eth(0)       ],
        expectedDepositsAfter:            [ eth(0),       aliceDeposit ],
        expectedETHDiffs:                 [ eth(0),       eth(0)       ],
        expectedContractETHDiff:          eth(0),
        expectedTotalDepositsDiff:        eth(0),
        event: { name: 'Transfer', args: [alice.address, bob.address, aliceDeposit] }
      });
    });

    it('transfer with amount > user\'s deposit', async() => {
      await verifyCallEffects({
        fromAccount: alice,
        call: ['transferDeposit', bob.address, aliceDeposit.mul(2)],
        verifiedUsers:                    [ alice,         bob    ],
        expectedDepositsBefore:           [ aliceDeposit,  eth(0) ],
        expectedDepositsAfter:            [ aliceDeposit,  eth(0) ],
        expectedETHDiffs:                 [ eth(0),        eth(0) ],
        reverted: true
      });
    });

    it('transferFrom with amount < user\'s deposit', async() => {
      await approveTransfer(alice, carol.address, aliceDeposit);
      await verifyCallEffects({
        fromAccount: carol,
        call: ['transferDepositFrom', alice.address, bob.address, aliceDeposit],
        verifiedUsers:                    [ alice,         bob,          carol  ],
        expectedDepositsBefore:           [ aliceDeposit,  eth(0),       eth(0) ],
        expectedDepositsAfter:            [ eth(0),        aliceDeposit, eth(0) ],
        expectedETHDiffs:                 [ eth(0),        eth(0),       eth(0) ],
        expectedContractETHDiff:          eth(0),
        expectedTotalDepositsDiff:        eth(0),
        event: { name: 'Transfer', args: [alice.address, bob.address, aliceDeposit] }
      });
    });

    it('transferFrom with amount > user\'s deposit', async() => {
      await approveTransfer(alice, carol.address, aliceDeposit.mul(2));
      await verifyCallEffects({
        fromAccount: carol,
        call: ['transferDepositFrom', alice.address, bob.address, aliceDeposit.mul(2)],
        verifiedUsers:                    [ alice,         bob,      carol  ],
        expectedDepositsBefore:           [ aliceDeposit,  eth(0),   eth(0) ],
        expectedDepositsAfter:            [ aliceDeposit,  eth(0),   eth(0) ],
        expectedETHDiffs:                 [ eth(0),        eth(0),   eth(0) ],
        reverted: true
      });
    });

    it('transferFrom with allowance < amount', async() => {
      await approveTransfer(alice, carol.address, aliceDeposit.div(2));
      await verifyCallEffects({
        fromAccount: carol,
        call: ['transferDepositFrom', alice.address, bob.address, aliceDeposit],
        verifiedUsers:                [ alice,         bob,    carol  ],
        expectedDepositsBefore:       [ aliceDeposit,  eth(0), eth(0) ],
        expectedDepositsAfter:        [ aliceDeposit,  eth(0), eth(0) ],
        expectedETHDiffs:             [ eth(0),        eth(0), eth(0) ],
        expectedContractETHDiff:      eth(0),
        expectedTotalDepositsDiff:    eth(0),
        reverted: true
      });
    });
  });

  describe('Transfer tests in PostDeposit', async() => {
    const aliceDeposit = eth(20);

    beforeEach(async() => {
      const contractData = contractsData[0];

      await serviceContract.connect(alice).deposit({ value: aliceDeposit });
      await serviceContract.connect(operator).deposit({ value: eth(12) });

      await serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        contractData.depositData.depositSignature,
        contractData.depositData.depositDataRoot,
        exitDate
      );

      expect(await serviceContract.getState()).to.equal(State.PostDeposit);
    });

    it('transfer', async() => {
      await verifyCallEffects({
        fromAccount: alice,
        call: ['transferDeposit', bob.address, aliceDeposit],
        verifiedUsers:               [ alice,        bob          ],
        expectedDepositsBefore:      [ aliceDeposit, eth(0)       ],
        expectedDepositsAfter:       [ eth(0),       aliceDeposit ],
        expectedETHDiffs:            [ eth(0),       eth(0)       ],
        expectedContractETHDiff:     eth(0),
        expectedTotalDepositsDiff:   eth(0),
        event: { name: 'Transfer', args: [alice.address, bob.address, aliceDeposit] }
      });
    });

    it('transferFrom', async() => {
      await approveTransfer(alice, carol.address, aliceDeposit);
      await verifyCallEffects({
        fromAccount: carol,
        call: ['transferDepositFrom', alice.address, bob.address, aliceDeposit],
        verifiedUsers:                [ alice,         bob,            carol  ],
        expectedDepositsBefore:       [ aliceDeposit,  eth(0),         eth(0) ],
        expectedDepositsAfter:        [ eth(0),        aliceDeposit,   eth(0) ],
        expectedETHDiffs:             [ eth(0),        eth(0),         eth(0) ],
        expectedContractETHDiff:      eth(0),
        expectedTotalDepositsDiff:    eth(0),
        event: { name: 'Transfer', args: [alice.address, bob.address, aliceDeposit] }
      });
    });
  });

  describe('Transfer tests in Withdrawn', async() => {
    const aliceDeposit = eth(20);

    beforeEach(async() => {
      const contractData = contractsData[0];

      await serviceContract.connect(alice).deposit({ value: aliceDeposit });
      await serviceContract.connect(operator).deposit({ value: eth(32).sub(aliceDeposit) });

      await serviceContract.connect(operator).createValidator(
        operatorPubKeyBytes,
        contractData.depositData.depositSignature,
        contractData.depositData.depositDataRoot,
        exitDate
      );

      await operator.sendTransaction({ to: serviceContract.address, value: eth(40) });
      await setNextBlockTimestamp(exitDate);
      await serviceContract.connect(operator).endOperatorServices();
      await serviceContract.connect(operator).operatorClaim();

      expect(await serviceContract.getState()).to.equal(State.Withdrawn);
    });

    it('transfer', async() => {
      await verifyCallEffects({
        fromAccount: alice,
        call: ['transferDeposit', bob.address, aliceDeposit],
        verifiedUsers:              [ alice,         bob          ],
        expectedDepositsBefore:     [ aliceDeposit,  eth(0)       ],
        expectedDepositsAfter:      [ eth(0),        aliceDeposit ],
        expectedETHDiffs:           [ eth(0),        eth(0)       ],
        expectedContractETHDiff:    eth(0),
        expectedTotalDepositsDiff:  eth(0),
        event: { name: 'Transfer', args: [alice.address, bob.address, aliceDeposit] }
      });
    });

    it('transferFrom', async() => {
      await approveTransfer(alice, carol.address, aliceDeposit);
      await verifyCallEffects({
        fromAccount: carol,
        call: ['transferDepositFrom', alice.address, bob.address, aliceDeposit],
        verifiedUsers:              [ alice,         bob,          carol  ],
        expectedDepositsBefore:     [ aliceDeposit,  eth(0),       eth(0) ],
        expectedDepositsAfter:      [ eth(0),        aliceDeposit, eth(0) ],
        expectedETHDiffs:           [ eth(0),        eth(0),       eth(0) ],
        expectedContractETHDiff:    eth(0),
        expectedTotalDepositsDiff:  eth(0),
        event: { name: 'Transfer', args: [alice.address, bob.address, aliceDeposit] }
      });
    });
  });
});
