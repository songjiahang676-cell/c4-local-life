import "@testing-library/jest-dom/vitest";
import type { AdminJobResponse, QueueDeadLetterCollection } from "@socal/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueOperationsWorkspace } from "../src/components/queue-operations-workspace";

const deadLetterId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const now = "2026-08-01T08:00:00.000Z";

const evidence: QueueDeadLetterCollection = {
  data: [
    {
      id: deadLetterId,
      eventId,
      source: "QUEUE",
      queueName: "socal-outbox",
      eventType: "listing.published",
      attemptCount: 3,
      failureCode: "JOB_HANDLER_FAILED",
      status: "OPEN",
      failedAt: now,
    },
  ],
  page: { hasMore: false, nextCursor: null },
  generatedAt: now,
};

const pendingJob: AdminJobResponse = {
  data: {
    id: jobId,
    type: "QUEUE_REPLAY",
    status: "PENDING",
    dryRun: false,
    estimatedItems: 1,
    processedItems: 0,
    succeededItems: 0,
    skippedItems: 0,
    failedItems: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("QueueOperationsWorkspace", () => {
  it("renders minimized evidence and creates an explicit confirmed replay batch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(evidence))
      .mockResolvedValueOnce(jsonResponse(pendingJob, 202));
    vi.stubGlobal("fetch", fetchMock);

    render(<QueueOperationsWorkspace locale="en-US" canAct />);

    expect(await screen.findByText("listing.published")).toBeInTheDocument();
    expect(screen.getByText("JOB_HANDLER_FAILED")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/payload|aggregate|private/i);

    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(eventId) }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /verified the targets, failure reason, and current code version/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create replay batch" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, request] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/v1/admin/system/queue/replay-batches");
    expect(request).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({
        "idempotency-key": expect.stringMatching(/^admin-queue-replay-/),
      }),
    });
    expect(JSON.parse(String(request.body))).toEqual({
      targets: [{ source: "QUEUE", targetId: deadLetterId }],
      reasonCode: "INCIDENT_RECOVERY",
    });
    expect(await screen.findByText("QUEUE_REPLAY")).toBeInTheDocument();
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
  });

  it("disables all mutations without recent MFA and makes repair confirmation explicit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(evidence))),
    );
    render(<QueueOperationsWorkspace locale="en-US" canAct={false} />);

    expect(await screen.findByText(/Writes require MFA verified/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create replay batch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create reconciliation job" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Preview only; do not repair" }));
    expect(
      screen.getByRole("checkbox", { name: /may repair derived DLQ evidence/i }),
    ).toBeInTheDocument();
  });

  it("keeps an in-flight dead letter read-only and reuses a retry key after a network failure", async () => {
    const mixedEvidence: QueueDeadLetterCollection = {
      ...evidence,
      data: [
        evidence.data[0]!,
        {
          ...evidence.data[0]!,
          id: "44444444-4444-4444-8444-444444444444",
          eventId: "55555555-5555-4555-8555-555555555555",
          status: "REPLAY_PENDING",
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(mixedEvidence))
      .mockResolvedValueOnce(jsonResponse({ title: "Unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse(pendingJob, 202));
    vi.stubGlobal("fetch", fetchMock);
    render(<QueueOperationsWorkspace locale="en-US" canAct />);

    const selectable = await screen.findByRole("checkbox", { name: new RegExp(eventId) });
    const pending = screen.getByRole("checkbox", { name: /55555555-5555-4555-8555-555555555555/ });
    expect(selectable).toBeEnabled();
    expect(pending).toBeDisabled();

    fireEvent.click(selectable);
    const confirmation = screen.getByRole("checkbox", {
      name: /verified the targets, failure reason, and current code version/i,
    });
    fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole("button", { name: "Create replay batch" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/job was not created/i);

    fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole("button", { name: "Create replay batch" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const firstHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<
      string,
      string
    >;
    const retryHeaders = (fetchMock.mock.calls[2]?.[1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(retryHeaders["idempotency-key"]).toBe(firstHeaders["idempotency-key"]);
  });

  it("applies normalized filters only after the operator submits them", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(evidence)));
    vi.stubGlobal("fetch", fetchMock);
    render(<QueueOperationsWorkspace locale="en-US" canAct />);

    await screen.findByText("listing.published");
    fireEvent.change(screen.getByRole("textbox", { name: "Failure code" }), {
      target: { value: "job_handler_failed" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondCall = fetchMock.mock.calls[1] as unknown as [string];
    expect(secondCall[0]).toContain("failureCode=JOB_HANDLER_FAILED");
  });
});
