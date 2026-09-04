/**
 * Bounds. Both the expert UI and the verifier import these, so a value the
 * UI accepts is a value the verifier accepts.
 */

/**
 * Every envelope and attestation carries this.
 *
 * Bumping it means adding a member to the version union, never replacing the
 * literal. Old versions must stay parsable, so design additively.
 */
export const SCHEMA_VERSION = 1;

/** A single HCS message. Verified against the protobuf reference, not guessed. */
export const HCS_MESSAGE_MAX_BYTES = 1024;

/** A whole HCS transaction, messages and signatures together. */
export const HCS_TRANSACTION_MAX_BYTES = 6144;

/**
 * `defects[]` is a bounded array of short structured codes. The written review
 * lives in the content store and only `notes_hash` goes on-chain, so these
 * bounds exist to keep an attestation inside one message rather than to limit
 * what an expert can say.
 */
export const DEFECTS_MAX_ITEMS = 8;
export const DEFECT_CODE_MAX_BYTES = 48;

export const CERT_TAG_MAX_BYTES = 32;
export const ORDER_ID_MAX_BYTES = 64;

/**
 * Claim-timeout bounds.
 *
 * Claim-timeout and order-deadline expiry are different events. The claim
 * timeout is short relative to the deadline so that a lazy claimant cannot hold
 * funds hostage until the order expires. These bounds keep it sane in
 * isolation; `assertClaimTimeoutFitsWindow` enforces the relative part once the
 * consensus timestamp is known.
 */
export const CLAIM_TIMEOUT_MIN_SECONDS = 300;
export const CLAIM_TIMEOUT_MAX_SECONDS = 21_600;

/** The claim timeout may take at most this share of the post-to-deadline window. */
export const CLAIM_TIMEOUT_MAX_SHARE_OF_WINDOW = 1 / 3;
