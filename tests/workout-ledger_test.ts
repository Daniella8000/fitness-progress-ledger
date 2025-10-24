import { describe, it, expect, beforeEach } from "vitest";
import { initSimnet } from "@hirosystems/clarinet-sdk";

describe("Fitness Progress Ledger - Core Functionality", () => {
  let simnet: ReturnType<typeof initSimnet>;
  let accounts: string[];

  beforeEach(async () => {
    simnet = await initSimnet();
    accounts = simnet.getAccounts();
  });

  describe("Account Initialization", () => {
    it("permits new account setup with identifier", () => {
      const setupResult = simnet.callPublicFn(
        "workout-ledger",
        "setup-account",
        ["alice_fitness"],
        accounts.get("wallet_1")!
      );

      expect(setupResult.isOk()).toBe(true);
    });

    it("retrieves account profile after initialization", () => {
      simnet.callPublicFn(
        "workout-ledger",
        "setup-account",
        ["bob_athlete"],
        accounts.get("wallet_2")!
      );

      const profileQuery = simnet.callReadOnlyFn(
        "workout-ledger",
        "query-account-info",
        [accounts.get("wallet_2")!],
        accounts.get("wallet_2")!
      );

      expect(profileQuery.result).toContainEqual(
        expect.objectContaining({
          "display-name": "bob_athlete",
          "activity-count": 0n,
        })
      );
    });

    it("tracks enrollment timestamp on account creation", () => {
      const blocksBefore = simnet.blockHeight;
      
      simnet.callPublicFn(
        "workout-ledger",
        "setup-account",
        ["charlie_runner"],
        accounts.get("wallet_3")!
      );

      const profile = simnet.callReadOnlyFn(
        "workout-ledger",
        "query-account-info",
        [accounts.get("wallet_3")!],
        accounts.get("wallet_3")!
      ).result;

      expect(profile).toContainEqual(
        expect.objectContaining({
          "enrollment-timestamp": expect.any(BigInt),
        })
      );
    });
  });

  describe("Activity Submission & Recording", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        "workout-ledger",
        "setup-account",
        ["fitness_tracker"],
        accounts.get("wallet_1")!
      );
    });

    it("accepts activity submission with valid parameters", () => {
      const submitResult = simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["running", 30n, 250n, null],
        accounts.get("wallet_1")!
      );

      expect(submitResult.isOk()).toBe(true);
      expect(submitResult.value).toBeDefined();
    });

    it("rejects activity with zero duration", () => {
      const submitResult = simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["cycling", 0n, 200n, null],
        accounts.get("wallet_1")!
      );

      expect(submitResult.isErr()).toBe(true);
      expect(submitResult.error).toEqual(109n); // fail-params-invalid
    });

    it("generates incrementing activity IDs", () => {
      const result1 = simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["walking", 20n, 100n, null],
        accounts.get("wallet_1")!
      );

      const result2 = simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["swimming", 45n, 350n, null],
        accounts.get("wallet_1")!
      );

      const id1 = result1.value;
      const id2 = result2.value;
      
      expect(Number(id2)).toBeGreaterThan(Number(id1));
    });

    it("stores activity with notes when provided", () => {
      const notesText = "Great morning session";
      
      simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["yoga", 60n, 150n, notesText],
        accounts.get("wallet_1")!
      );

      // Retrieve the activity
      const activities = simnet.callReadOnlyFn(
        "workout-ledger",
        "fetch-activity-by-id",
        [1n, accounts.get("wallet_1")!],
        accounts.get("wallet_1")!
      ).result;

      expect(activities).toContainEqual(
        expect.objectContaining({
          "session-notes": notesText,
        })
      );
    });

    it("updates account activity counter on submission", () => {
      simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["weightlifting", 45n, 300n, null],
        accounts.get("wallet_1")!
      );

      simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["hiit", 25n, 280n, null],
        accounts.get("wallet_1")!
      );

      const profile = simnet.callReadOnlyFn(
        "workout-ledger",
        "query-account-info",
        [accounts.get("wallet_1")!],
        accounts.get("wallet_1")!
      ).result;

      expect(profile).toContainEqual(
        expect.objectContaining({
          "activity-count": 2n,
        })
      );
    });

    it("updates most recent activity timestamp", () => {
      simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["pilates", 50n, 180n, null],
        accounts.get("wallet_1")!
      );

      const profile = simnet.callReadOnlyFn(
        "workout-ledger",
        "query-account-info",
        [accounts.get("wallet_1")!],
        accounts.get("wallet_1")!
      ).result;

      expect(profile).toContainEqual(
        expect.objectContaining({
          "most-recent-activity": expect.any(BigInt),
        })
      );
    });
  });

  describe("Competition Management", () => {
    let competitionId: bigint;

    beforeEach(() => {
      const launchResult = simnet.callPublicFn(
        "workout-ledger",
        "launch-competition",
        [
          "Spring Marathon Challenge",
          "Complete 15 running sessions in 60 days",
          simnet.blockHeight + 10n,
          simnet.blockHeight + 100n,
          15n,
          20n,
          1000n,
        ],
        accounts.get("wallet_1")!
      );

      competitionId = launchResult.value as bigint;
    });

    it("creates competition with correct parameters", () => {
      const compResult = simnet.callPublicFn(
        "workout-ledger",
        "launch-competition",
        [
          "Winter Fitness Sprint",
          "30-day activity challenge",
          simnet.blockHeight + 5n,
          simnet.blockHeight + 50n,
          20n,
          15n,
          2000n,
        ],
        accounts.get("wallet_2")!
      );

      expect(compResult.isOk()).toBe(true);
      expect(compResult.value).toBeDefined();
    });

    it("rejects competition with invalid time window", () => {
      const badResult = simnet.callPublicFn(
        "workout-ledger",
        "launch-competition",
        [
          "Invalid Competition",
          "Bad dates",
          simnet.blockHeight + 100n,
          simnet.blockHeight + 50n, // end before start
          10n,
          20n,
          500n,
        ],
        accounts.get("wallet_1")!
      );

      expect(badResult.isErr()).toBe(true);
      expect(badResult.error).toEqual(109n); // fail-params-invalid
    });

    it("rejects competition starting in the past", () => {
      const pastResult = simnet.callPublicFn(
        "workout-ledger",
        "launch-competition",
        [
          "Past Competition",
          "Already started",
          simnet.blockHeight - 10n,
          simnet.blockHeight + 50n,
          10n,
          20n,
          500n,
        ],
        accounts.get("wallet_1")!
      );

      expect(pastResult.isErr()).toBe(true);
    });

    it("rejects competition with zero activity target", () => {
      const zeroResult = simnet.callPublicFn(
        "workout-ledger",
        "launch-competition",
        [
          "Zero Target",
          "No activities required",
          simnet.blockHeight + 10n,
          simnet.blockHeight + 50n,
          0n, // zero target
          20n,
          500n,
        ],
        accounts.get("wallet_1")!
      );

      expect(zeroResult.isErr()).toBe(true);
    });

    it("rejects competition with zero minimum duration", () => {
      const zeroDurationResult = simnet.callPublicFn(
        "workout-ledger",
        "launch-competition",
        [
          "Zero Duration",
          "No minimum time",
          simnet.blockHeight + 10n,
          simnet.blockHeight + 50n,
          10n,
          0n, // zero minimum duration
          500n,
        ],
        accounts.get("wallet_1")!
      );

      expect(zeroDurationResult.isErr()).toBe(true);
    });

    it("retrieves competition details correctly", () => {
      const compInfo = simnet.callReadOnlyFn(
        "workout-ledger",
        "fetch-competition-info",
        [competitionId],
        accounts.get("wallet_1")!
      ).result;

      expect(compInfo).toContainEqual(
        expect.objectContaining({
          title: "Spring Marathon Challenge",
          "required-activities": 15n,
          "participation-reward": 1000n,
          "is-operational": true,
        })
      );
    });

    it("allows enrollment in future competition", () => {
      // Advance blocks to start competition
      simnet.mineBlock();
      for (let i = 0; i < 10; i++) {
        simnet.mineBlock();
      }

      const enrollResult = simnet.callPublicFn(
        "workout-ledger",
        "enroll-in-competition",
        [competitionId],
        accounts.get("wallet_2")!
      );

      expect(enrollResult.isOk()).toBe(true);
    });

    it("prevents enrollment before competition starts", () => {
      const enrollResult = simnet.callPublicFn(
        "workout-ledger",
        "enroll-in-competition",
        [competitionId],
        accounts.get("wallet_3")!
      );

      expect(enrollResult.isErr()).toBe(true);
      expect(enrollResult.error).toEqual(106n); // fail-competition-inactive
    });

    it("tracks enrollment status for participants", () => {
      // Advance to active period
      for (let i = 0; i < 15; i++) {
        simnet.mineBlock();
      }

      simnet.callPublicFn(
        "workout-ledger",
        "enroll-in-competition",
        [competitionId],
        accounts.get("wallet_2")!
      );

      const enrollmentInfo = simnet.callReadOnlyFn(
        "workout-ledger",
        "check-competition-enrollment",
        [competitionId, accounts.get("wallet_2")!],
        accounts.get("wallet_2")!
      ).result;

      expect(enrollmentInfo).toContainEqual(
        expect.objectContaining({
          "activities-logged": 0n,
          "has-completed-target": false,
        })
      );
    });
  });

  describe("Multi-User Scenarios", () => {
    it("maintains separate activity records per user", () => {
      simnet.callPublicFn(
        "workout-ledger",
        "setup-account",
        ["user_a"],
        accounts.get("wallet_1")!
      );

      simnet.callPublicFn(
        "workout-ledger",
        "setup-account",
        ["user_b"],
        accounts.get("wallet_2")!
      );

      simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["running", 30n, 250n, null],
        accounts.get("wallet_1")!
      );

      simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["cycling", 45n, 300n, null],
        accounts.get("wallet_2")!
      );

      simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["swimming", 40n, 350n, null],
        accounts.get("wallet_2")!
      );

      const userAProfile = simnet.callReadOnlyFn(
        "workout-ledger",
        "query-account-info",
        [accounts.get("wallet_1")!],
        accounts.get("wallet_1")!
      ).result;

      const userBProfile = simnet.callReadOnlyFn(
        "workout-ledger",
        "query-account-info",
        [accounts.get("wallet_2")!],
        accounts.get("wallet_2")!
      ).result;

      expect(userAProfile).toContainEqual(
        expect.objectContaining({
          "activity-count": 1n,
        })
      );

      expect(userBProfile).toContainEqual(
        expect.objectContaining({
          "activity-count": 2n,
        })
      );
    });

    it("allows multiple users to compete in same competition", () => {
      const compResult = simnet.callPublicFn(
        "workout-ledger",
        "launch-competition",
        [
          "Community Fitness",
          "Competitive 60-day challenge",
          simnet.blockHeight + 5n,
          simnet.blockHeight + 80n,
          25n,
          20n,
          5000n,
        ],
        accounts.get("wallet_1")!
      );

      const compId = compResult.value as bigint;

      // Advance to active phase
      for (let i = 0; i < 10; i++) {
        simnet.mineBlock();
      }

      const enroll1 = simnet.callPublicFn(
        "workout-ledger",
        "enroll-in-competition",
        [compId],
        accounts.get("wallet_2")!
      );

      const enroll2 = simnet.callPublicFn(
        "workout-ledger",
        "enroll-in-competition",
        [compId],
        accounts.get("wallet_3")!
      );

      expect(enroll1.isOk()).toBe(true);
      expect(enroll2.isOk()).toBe(true);
    });
  });

  describe("Activity Ledger Persistence", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        "workout-ledger",
        "setup-account",
        ["persistent_tracker"],
        accounts.get("wallet_1")!
      );
    });

    it("preserves activity data across multiple submissions", () => {
      const activities = [
        ["running", 35n, 280n],
        ["cycling", 50n, 320n],
        ["yoga", 60n, 140n],
      ];

      for (const [type, duration, energy] of activities) {
        simnet.callPublicFn(
          "workout-ledger",
          "submit-activity",
          [type, duration, energy, null],
          accounts.get("wallet_1")!
        );
      }

      const record1 = simnet.callReadOnlyFn(
        "workout-ledger",
        "fetch-activity-by-id",
        [1n, accounts.get("wallet_1")!],
        accounts.get("wallet_1")!
      ).result;

      const record2 = simnet.callReadOnlyFn(
        "workout-ledger",
        "fetch-activity-by-id",
        [2n, accounts.get("wallet_1")!],
        accounts.get("wallet_1")!
      ).result;

      expect(record1).toContainEqual(
        expect.objectContaining({
          "activity-category": "running",
          "time-spent-minutes": 35n,
        })
      );

      expect(record2).toContainEqual(
        expect.objectContaining({
          "activity-category": "cycling",
          "time-spent-minutes": 50n,
        })
      );
    });

    it("records block timestamp for each activity", () => {
      simnet.callPublicFn(
        "workout-ledger",
        "submit-activity",
        ["running", 40n, 300n, null],
        accounts.get("wallet_1")!
      );

      const activity = simnet.callReadOnlyFn(
        "workout-ledger",
        "fetch-activity-by-id",
        [1n, accounts.get("wallet_1")!],
        accounts.get("wallet_1")!
      ).result;

      expect(activity).toContainEqual(
        expect.objectContaining({
          "block-timestamp": expect.any(BigInt),
        })
      );
    });
  });
});
