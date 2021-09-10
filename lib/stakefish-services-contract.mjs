"use strict";

const blsLib = await import("@chainsafe/bls");

try {
  await blsLib.init("blst-native");
} catch (e) {
  await blsLib.init("herumi");
  console.warn("Using WASM BLS");
}

export const { bls } = blsLib;

const ssz = await import("@chainsafe/ssz");
const { keccak256, solidityPack } = await import("ethers/lib/utils.js");

export const HOUR = 3600;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const YEAR = 365 * DAY;
export const COMMISSION_RATE_SCALE = 1_000_000;

const DEPOSIT_AMOUNT = BigInt(32_000_000_000);

export const DomainType = {
  BEACON_PROPOSER: 0,
  BEACON_ATTESTER: 1,
  RANDAO: 2,
  DEPOSIT: 3,
  VOLUNTARY_EXIT: 4,
  SELECTION_PROOF: 5,
  AGGREGATE_AND_PROOF: 6,
  SYNC_COMMITTEE: 7,
  SYNC_COMMITTEE_SELECTION_PROOF: 8,
  CONTRIBUTION_AND_PROOF: 9
}

export const State = {
  NotInitialized: 0,
  PreDeposit: 1,
  PostDeposit: 2,
  Withdrawn: 3
};

export const SignatureSchema = new ssz.ContainerType({
  fields: {
    rootHash: new ssz.ByteVectorType({
      length: 32,
    }),
    domain: new ssz.ByteVectorType({
      length: 32,
    })
  }
});

export const DepositMessageSchema = new ssz.ContainerType({
  fields: {
    validatorPubKey: new ssz.ByteVectorType({
      length: 48,
    }),
    withdrawalCredentials: new ssz.ByteVectorType({
      length: 32,
    }),
    depositAmount: new ssz.BigIntUintType({
      byteLength: 8,
    })
  }
});

export const DepositDataSchema = new ssz.ContainerType({
  fields: {
    pubKey: new ssz.ByteVectorType({
      length: 48,
    }),
    withdrawalCredentials: new ssz.ByteVectorType({
      length: 32,
    }),
    amount: new ssz.BigIntUintType({
      byteLength: 8,
    }),
    signature: new ssz.ByteVectorType({
      length: 96,
    })
  }
});

export const VoluntaryExitSchema = new ssz.ContainerType({
  fields: {
    epoch: new ssz.UintType({
      byteLength: 8,
    }),
    validatorIndex: new ssz.UintType({
      byteLength: 8,
    })
  }
});

export const ForkData = new ssz.ContainerType({
  fields: {
    forkVersion: new ssz.ByteVectorType({
      length: 4,
    }),
    genesisValidatorsRoot: new ssz.ByteVectorType({
      length: 32,
    }),
  },
});

export function computeSigningDomain(domainType, genesisValidatorsRoot) {
  const forkVersion = Buffer.from('00000000', 'hex'); // mainnet
  const domainTypeBytes = Buffer.from([domainType, 0, 0, 0]);
  const forkDataRoot = ForkData.hashTreeRoot({
    forkVersion,
    genesisValidatorsRoot
  });
  return Buffer.concat([domainTypeBytes, forkDataRoot.slice(0, 28)])
}

export const DEPOSIT_CONTRACT_ADDRESS =
  "0x00000000219ab540356cBB839Cbe05303d7705Fa";

// TODO We should document how this is computed
export const DEPOSIT_DOMAIN = Buffer.from(
  "f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b", "hex");

export const GENESIS_TIME = 1606824023;
export const GENESIS_VALIDATORS_ROOT =
  "4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95";

export const VOLUNTARY_EXIT_DOMAIN = computeSigningDomain(
  DomainType.VOLUNTARY_EXIT, GENESIS_VALIDATORS_ROOT);

export function poolWithdrawalCredentials(poolAddress) {
  return Buffer.concat([
    Buffer.from('010000000000000000000000', 'hex'),
    Buffer.from(poolAddress.slice(2), 'hex')]);
}

export function createOperatorDepositData(validatorKey, depositPoolAddress) {
  const validatorPubKeyBytes = validatorKey.toPublicKey().toBytes();
  const withdrawalCredentials = poolWithdrawalCredentials(depositPoolAddress);
  const depositMessageRoot = DepositMessageSchema.hashTreeRoot({
    validatorPubKey: validatorPubKeyBytes,
    withdrawalCredentials: withdrawalCredentials,
    depositAmount: DEPOSIT_AMOUNT
  });
  const signingRoot = SignatureSchema.hashTreeRoot({
    rootHash: depositMessageRoot,
    domain: DEPOSIT_DOMAIN
  });
  const signature = bls.sign(validatorKey.toBytes(), signingRoot);
  const depositDataRoot = DepositDataSchema.hashTreeRoot({
    pubKey: validatorPubKeyBytes,
    withdrawalCredentials: withdrawalCredentials,
    amount: DEPOSIT_AMOUNT,
    signature: signature
  });
  return {
    validatorPubKey: validatorPubKeyBytes,
    depositSignature: signature,
    depositDataRoot: depositDataRoot
  };
}

export function createOperatorCommitment(
  serviceContractAddress,
  validatorPubKey,
  depositSignature,
  depositDataRoot,
  exitDate
) {
  return keccak256(
    solidityPack(
      ["address", "bytes", "bytes", "bytes32", "uint64"],
      [
        serviceContractAddress,
        validatorPubKey,
        depositSignature,
        depositDataRoot,
        exitDate
      ]
    )
  );
}

export function createVoluntaryExitSignature(
  validatorKey,
  epoch,
  validatorIndex
) {
  const voluntaryExitRoot = VoluntaryExitSchema.hashTreeRoot({ epoch, validatorIndex });
  const signingRoot = SignatureSchema.hashTreeRoot({
    rootHash: voluntaryExitRoot,
    domain: VOLUNTARY_EXIT_DOMAIN
  });
  return bls.sign(validatorKey.toBytes(), signingRoot);
}

