import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatAbsoluteDate,
  formatRelativeTime,
  formatTimeOnly,
} from "../../lib/utils/format-date";
import {
  resolveInboxPagination,
  parseInboxListQuery,
  INBOX_DEFAULT_PAGE_LIMIT,
} from "../../lib/application/inbox-contracts";
import { INITIAL_INBOX_FILTERS } from "../../components/inbox/inbox-types";

describe("Inbox UI Utilities and Formatting (P2.6 Tahap 2)", () => {
  it("formatAbsoluteDate formats fixed UTC timestamps into exact Asia/Jakarta (WIB) time", () => {
    // 2026-09-19T02:41:00.000Z is 09:41 WIB (UTC+7)
    const result1 = formatAbsoluteDate("2026-09-19T02:41:00.000Z");
    assert.equal(result1, "19 Sep 2026, 09.41 WIB");

    // 2026-09-19T18:30:00.000Z crosses midnight into 20 Sep 2026, 01.30 WIB
    const result2 = formatAbsoluteDate("2026-09-19T18:30:00.000Z");
    assert.equal(result2, "20 Sep 2026, 01.30 WIB");

    // 2026-12-31T20:00:00.000Z crosses new year into 1 Jan 2027, 03.00 WIB
    const result3 = formatAbsoluteDate("2026-12-31T20:00:00.000Z");
    assert.equal(result3, "1 Jan 2027, 03.00 WIB");
  });

  it("formatTimeOnly formats time into exact 'HH.mm WIB' using Asia/Jakarta timezone", () => {
    const result1 = formatTimeOnly("2026-09-19T02:41:00.000Z");
    assert.equal(result1, "09.41 WIB");

    const result2 = formatTimeOnly("2026-09-19T18:30:00.000Z");
    assert.equal(result2, "01.30 WIB");
  });

  it("formatRelativeTime handles various time deltas accurately", () => {
    const now = new Date(2026, 8, 19, 10, 0, 0);

    // 5 seconds ago -> "baru saja"
    const t5s = new Date(now.getTime() - 5000);
    assert.equal(formatRelativeTime(t5s.toISOString(), now), "baru saja");

    // 45 seconds ago -> "45 dtk lalu"
    const t45s = new Date(now.getTime() - 45000);
    assert.equal(formatRelativeTime(t45s.toISOString(), now), "45 dtk lalu");

    // 5 minutes ago -> "5 mnt lalu"
    const t5m = new Date(now.getTime() - 5 * 60 * 1000);
    assert.equal(formatRelativeTime(t5m.toISOString(), now), "5 mnt lalu");

    // 2 hours ago -> "2 jam lalu"
    const t2h = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    assert.equal(formatRelativeTime(t2h.toISOString(), now), "2 jam lalu");

    // 1 day ago -> "kemarin"
    const t1d = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    assert.equal(formatRelativeTime(t1d.toISOString(), now), "kemarin");

    // 3 days ago -> "3 hr lalu"
    const t3d = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    assert.equal(formatRelativeTime(t3d.toISOString(), now), "3 hr lalu");
  });

  it("formatRelativeTime and formatAbsoluteDate handle invalid/empty input gracefully", () => {
    assert.equal(formatAbsoluteDate(""), "-");
    assert.equal(formatTimeOnly(""), "-");
    assert.equal(formatRelativeTime(""), "-");
  });

  it("INITIAL_INBOX_FILTERS conforms to contract defaults", () => {
    assert.equal(INITIAL_INBOX_FILTERS.status, "all");
    assert.equal(INITIAL_INBOX_FILTERS.episodeStatus, "any");
    assert.equal(INITIAL_INBOX_FILTERS.unread, undefined);
    assert.equal(INITIAL_INBOX_FILTERS.needsReview, undefined);
    assert.equal(INITIAL_INBOX_FILTERS.search, "");
  });

  it("resolveInboxPagination enforces boundaries and safe integer offset", () => {
    const valid = resolveInboxPagination(1, INBOX_DEFAULT_PAGE_LIMIT);
    assert.equal(valid.valid, true);
    if (valid.valid) {
      assert.equal(valid.page, 1);
      assert.equal(valid.limit, 25);
      assert.equal(valid.offset, 0);
    }

    const invalidLimit = resolveInboxPagination(1, 30);
    assert.equal(invalidLimit.valid, false);

    const invalidPage = resolveInboxPagination(0, 25);
    assert.equal(invalidPage.valid, false);
  });

  it("parseInboxListQuery accepts all valid filters and rejects invalid params", () => {
    const params = new URLSearchParams({
      page: "2",
      limit: "25",
      status: "active",
      episodeStatus: "NEW",
      unread: "true",
      needsReview: "false",
      search: "internet mati",
    });

    const parsed = parseInboxListQuery(params);
    assert.equal(parsed.valid, true);
    if (parsed.valid) {
      assert.equal(parsed.query.page, 2);
      assert.equal(parsed.query.limit, 25);
      assert.equal(parsed.query.status, "active");
      assert.equal(parsed.query.episodeStatus, "NEW");
      assert.equal(parsed.query.unread, true);
      assert.equal(parsed.query.needsReview, false);
      assert.equal(parsed.query.search, "internet mati");
    }
  });
});
