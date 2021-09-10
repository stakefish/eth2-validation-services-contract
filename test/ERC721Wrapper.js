const { ethers } = require('hardhat');
const { arrayify, zeroPad, keccak256 } = ethers.utils;
const chai = require('chai');
const ChaiAsPromised = require('chai-as-promised');
const BigNumber = ethers.BigNumber;
const expect = chai.expect;

chai.use(ChaiAsPromised);

describe('StakefishERC721Wrapper', () => {
  const exitDate = BigNumber.from(new Date().getTime() + 10000);

  const safeTransferFrom = 'safeTransferFrom(address,address,uint256,bytes)';

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  let ERC721;
  let servicesContract;
  let owner, receiver, operator;

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

    const StakefishERC721Wrapper = await ethers.getContractFactory(
      'StakefishERC721Wrapper'
    );

    const factory = await StakefishServicesContractFactory.deploy(1000);
    await factory.deployed();

    // get tamplete address
    let implAddress = await factory.getServicesContractImpl();

    // Standard bytecode for basic proxy contract for EIP-1167
    let initCodeHash = keccak256('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + implAddress.substring(2) + '5af43d82803e903d91602b57fd5bf3');

    let saltValue = zeroPad(arrayify(BigNumber.from(0)), 32);

    // calculate new contract address
    var newContractAddress = ethers.utils.getCreate2Address(
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

    ERC721 = await StakefishERC721Wrapper.deploy();
    await ERC721.deployed();
  });

  describe('Getter functions', () => {
    it('balanceOf() should return correct balance for quried address', async () => {
      let balance = await ERC721.balanceOf(owner.address);
      expect(balance).to.be.equal(0);

      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC721.address, 100);
      await ERC721.mint(servicesContract.address, 100);

      balance = await ERC721.balanceOf(owner.address);
      expect(balance).to.be.equal(1);
    });

    it('ownerOf() should return correct token owner address', async () => {
      await expect(ERC721.ownerOf(0)).to.be.reverted;

      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC721.address, 100);
      await ERC721.mint(servicesContract.address, 100);

      const tokenOwner = await ERC721.ownerOf(0);
      expect(tokenOwner).to.be.equal(owner.address);
    });

    it('supportsInterface() should support erc721 and erc165', async () => {
      const erc721Interface = await ERC721.supportsInterface('0x80ac58cd');
      const erc165Interface = await ERC721.supportsInterface('0x01ffc9a7');
      const other = await ERC721.supportsInterface('0x12345678');

      expect(erc721Interface).to.be.equal(true);
      expect(erc165Interface).to.be.equal(true);
      expect(other).to.be.equal(false);
    });
  });

  describe('safeTransferFrom()', () => {
    let receiverContract;
    let tokenId;

    beforeEach(async () => {
      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC721.address, 100);
      await ERC721.mint(servicesContract.address, 100);
      tokenId = 0;
    });

    it('shoud update balance correctly', async () => {
      await ERC721[safeTransferFrom](owner.address, receiver.address, tokenId, []);
      const ownerBalance = await ERC721.balanceOf(owner.address);
      const receiverBalance = await ERC721.balanceOf(receiver.address);

      expect(ownerBalance).to.be.equal(0);
      expect(receiverBalance).to.be.equal(1);
    });

    it('should update ownership correctly', async () => {
      await ERC721[safeTransferFrom](owner.address, receiver.address, tokenId, []);
      const tokenOwner = await ERC721.ownerOf(tokenId);
      expect(tokenOwner).to.be.equal(receiver.address);
    });

    it('should revert if from is not token owner', async () => {
      const user = (await ethers.getSigners())[3];
      const tx = ERC721[safeTransferFrom](user.address, receiver.address, tokenId, []);
      await expect(tx).to.be.reverted;
    });

    it('should revert if operator is not authorized', async () => {
      const user = (await ethers.getSigners())[3];
      const tx = ERC721.connect(user)[safeTransferFrom](owner.address, receiver.address, tokenId, []);
      await expect(tx).to.be.reverted;
    });

    it('should revert if from is not token owner but sent by authorized operator', async () => {
      const user = (await ethers.getSigners())[3];
      await ERC721.connect(user).setApprovalForAll(operator.address, true);
      const tx = ERC721.connect(operator)[safeTransferFrom](user.address, receiver.address, tokenId, []);
      await expect(tx).to.be.reverted;
    });

    it('should be able to transfer if auhtorized operator is authorized', async () => {
      await ERC721.setApprovalForAll(operator.address, true);
      const tx = ERC721.connect(operator)[safeTransferFrom](owner.address, receiver.address, tokenId, []);
      await expect(tx).to.be.fulfilled;

      const ownerBalance = await ERC721.balanceOf(owner.address);
      const receiverBalance = await ERC721.balanceOf(receiver.address);
      const tokenOwner = await ERC721.ownerOf(tokenId);
      expect(ownerBalance).to.be.equal(0);
      expect(receiverBalance).to.be.equal(1);
      expect(tokenOwner).to.be.equal(receiver.address);
    });

    it('should revert if to is not a receiver contract', async () => {
      const tx = ERC721[safeTransferFrom](owner.address, ERC721.address, tokenId, []);
      expect(tx).to.be.reverted;
    });

    describe('When receiver is a contract', () => {
      beforeEach(async () => {
        const ReceiverContract = await ethers.getContractFactory('ERC721ReceiverMock');
        receiverContract = await ReceiverContract.deploy();
        await receiverContract.deployed();
      });

      it('should be able to transfer if to is a receiver contract', async () => {
        const tx = ERC721[safeTransferFrom](owner.address, receiverContract.address, tokenId, []);
        await expect(tx).to.be.fulfilled;

        const ownerBalance = await ERC721.balanceOf(owner.address);
        const receiverBalance = await ERC721.balanceOf(receiverContract.address);
        const tokenOwner = await ERC721.ownerOf(tokenId);
        expect(ownerBalance).to.be.equal(BigNumber.from(0));
        expect(receiverBalance).to.be.equal(BigNumber.from(1));
        expect(tokenOwner).to.be.equal(receiverContract.address);
      });

      it('should revert if receiver contract reject', async () => {
        await receiverContract.setShouldReject(true);
        const tx = ERC721[safeTransferFrom](owner.address, receiverContract.address, tokenId, []);
        await expect(tx).to.be.reverted;
      });

      it('should be able to transfer to receiver contract with data', async () => {
        const rejectData = ethers.utils.toUtf8Bytes('Hello');
        const rejectTx = ERC721[safeTransferFrom](owner.address, receiverContract.address, tokenId, rejectData);
        await expect(rejectTx).to.be.reverted;

        const data = ethers.utils.toUtf8Bytes('Hello from the other side');
        const tx = ERC721[safeTransferFrom](owner.address, receiverContract.address, tokenId, data);
        await expect(tx).to.be.fulfilled;
      });

      it('should have balances and ownership updated before external call', async () => {
        const ownerBalance = await ERC721.balanceOf(owner.address);
        const receiverBalance = await ERC721.balanceOf(receiver.address);
        const filter = receiverContract.filters.TransferReceiver();
        await ERC721[safeTransferFrom](owner.address, receiverContract.address, tokenId, []);
        const events = await receiverContract.queryFilter(filter);

        expect(events.length).to.be.equal(1);
        expect(events[0].args._from).to.be.equal(owner.address);
        expect(events[0].args._to).to.be.equal(receiverContract.address);
        expect(events[0].args._fromBalance).to.be.equal(ownerBalance.sub(1));
        expect(events[0].args._toBalance).to.be.equal(receiverBalance.add(1));
        expect(events[0].args._tokenOwner).to.be.equal(receiverContract.address);
      });
    });

    it('should emit Transfer event', async () => {
      const tx = ERC721[safeTransferFrom](owner.address, receiver.address, tokenId, []);
      await expect(tx).to.emit(ERC721, 'Transfer')
        .withArgs(owner.address, receiver.address, tokenId);
    });

    it('should reset token operator after transfer', async () => {
      await ERC721.approve(operator.address, tokenId);
      await ERC721[safeTransferFrom](owner.address, receiver.address, tokenId, []);

      const approvedOperator = await ERC721.getApproved(tokenId);
      expect(approvedOperator).to.be.equal(ZERO_ADDRESS);
    });

    it('should be able to transfer without data', async () => {
      const tx = ERC721['safeTransferFrom(address,address,uint256)'](
        owner.address,
        receiver.address,
        tokenId
      );

      await expect(tx).to.be.fulfilled;
    });
  });

  describe('transferFrom()', () => {
    let receiverContract;
    let tokenId;

    beforeEach(async () => {
      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC721.address, 100);
      await ERC721.mint(servicesContract.address, 100);
      tokenId = 0;

      const ReceiverContract = await ethers.getContractFactory('ERC721ReceiverMock');
      receiverContract = await ReceiverContract.deploy();
      await receiverContract.deployed();
    });
    
    it('should be able to transfer with balances updated', async () => {
      const tx = ERC721.transferFrom(owner.address, receiver.address, tokenId);
      
      await expect(tx).to.be.fulfilled;
      const ownerBalance = await ERC721.balanceOf(owner.address);
      const receiverBalance = await ERC721.balanceOf(receiver.address);

      expect(ownerBalance).to.be.equal(0);
      expect(receiverBalance).to.be.equal(1);
    });

    it('should not call receiver contract\'s onReceived function', async () => {
      const tx = ERC721.transferFrom(owner.address, receiverContract.address, tokenId);
      
      await expect(tx).to.not.emit(receiverContract, 'TransferReceiver');
    });
  });

  describe('approve()', () => {
    let tokenId;

    beforeEach(async () => {
      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC721.address, 100);
      await ERC721.mint(servicesContract.address, 100);
      tokenId = 0;
    });

    it('should update token\'s approved operator', async () => {
      const defaultOperator = await ERC721.getApproved(tokenId);
      expect(defaultOperator).to.be.equal(ZERO_ADDRESS);

      await ERC721.approve(operator.address, tokenId);
      const approvedOperator = await ERC721.getApproved(tokenId);
      expect(approvedOperator).to.be.equal(operator.address);
    });

    it('should revert if tx not sent by token owner or authorized operator', async () => {
      const notAuthorizedTx = ERC721.connect(receiver).approve(operator.address, tokenId);
      await expect(notAuthorizedTx).to.be.reverted;

      await ERC721.setApprovalForAll(receiver.address, true);
      const authorizedTx = ERC721.connect(receiver).approve(operator.address, tokenId);
      await expect(authorizedTx).to.be.fulfilled;
    });

    it('should revert if token does not exist', async () => {
      const notExistTokenId = 1;
      const tx = ERC721.approve(operator.address, notExistTokenId);
      await expect(tx).to.be.reverted;
    });

    it('should emit Approval event', async () => {
      const tx = ERC721.approve(operator.address, tokenId);
      await expect(tx).to.emit(ERC721, 'Approval')
        .withArgs(owner.address, operator.address, tokenId);
    });
  });

  describe('mintTo()', () => {
    beforeEach(async () => {
      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC721.address, 100);
    });

    it('should revert if amount is zero', async () => {
      const tx = ERC721.mintTo(servicesContract.address, owner.address, 0);
      await expect(tx).to.be.reverted;
    });

    it('should revert if mint more than approved amount', async () => {
      const tx = ERC721.mintTo(servicesContract.address, owner.address, 101);
      await expect(tx).to.be.reverted;
    });

    it('should be able to mint approved amount', async () => {
      const tx = ERC721.mintTo(servicesContract.address, owner.address, 100);
      const tokenId = 0;
      await expect(tx).to.emit(ERC721, 'Mint')
        .withArgs(servicesContract.address, owner.address, owner.address, 100, tokenId);

      const servicesContractAddr = await ERC721.getServicesContract(tokenId);
      expect(servicesContractAddr).to.be.equal(servicesContract.address);

      const balance = await ERC721.balanceOf(owner.address);
      expect(balance).to.be.equal(1);
    });

    it('should be able to mint for others', async () => {
      await ERC721.mintTo(servicesContract.address, receiver.address, 100);

      const ownerBalance = await ERC721.balanceOf(owner.address);
      const receiverBalance = await ERC721.balanceOf(receiver.address);
      expect(ownerBalance).to.be.equal(0);
      expect(receiverBalance).to.be.equal(1);
    });

    it('token id should be increasing', async () => {
      let tx = ERC721.mintTo(servicesContract.address, owner.address, 10);
      await expect(tx).to.emit(ERC721, 'Mint') .withArgs(servicesContract.address, owner.address, owner.address, 10, 0);

      tx = ERC721.mintTo(servicesContract.address, owner.address, 10);
      await expect(tx).to.emit(ERC721, 'Mint')
        .withArgs(servicesContract.address, owner.address, owner.address, 10, 1);
    });
  });

  describe('redeemTo()', () => {
    let tokenId;

    beforeEach(async () => {
      owner.sendTransaction({
        to: servicesContract.address,
        value: 100
      });
      await servicesContract.approve(ERC721.address, 100);
      await ERC721.mint(servicesContract.address, 100);
      tokenId = 0;
    });

    it('should revert if operator is not token owner', async () => {
      const tx = ERC721.connect(receiver).redeemTo(1, receiver.address);
      await expect(tx).to.be.reverted;
    });

    it('should be able to redeem by token owner', async () => {
      const tx = ERC721.redeemTo(tokenId, owner.address);
      await expect(tx).to.emit(ERC721, 'Redeem')
        .withArgs(servicesContract.address, owner.address, owner.address, 100, tokenId);
      const deposit = await servicesContract.getDeposit(owner.address);
      const balance = await ERC721.balanceOf(owner.address);

      expect(deposit).to.be.equal(100);
      expect(balance).to.be.equal(0);
    });
  });
});
