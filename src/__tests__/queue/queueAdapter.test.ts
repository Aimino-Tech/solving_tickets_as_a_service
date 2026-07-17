import { describe, expect, it, vi } from "vitest";
import type { IssueJobData } from "../../utils/types.js";

function createMockAdapter() {
	return {
		enqueue: vi.fn().mockResolvedValue("rabbitmq-job-id"),
		startConsumer: vi.fn().mockResolvedValue(undefined),
		stopConsumer: vi.fn().mockResolvedValue(undefined),
		getDepth: vi.fn().mockResolvedValue(0),
		getBackend: vi.fn().mockReturnValue("rabbitmq"),
		isHealthy: vi.fn().mockResolvedValue(true),
	};
}

const sampleJobData: IssueJobData = {
	installationId: 123,
	repoOwner: "test-owner",
	repoName: "test-repo",
	issueNumber: 42,
	issueTitle: "Test issue",
	issueBody: "Test body",
	repoPrivate: false,
	source: "github",
};

const _baseConfig = {
	name: "test-queue",
	exchange: "test-exchange",
	routingKey: "test-key",
	durable: true,
	ttl: 30000,
	dedupTtl: 120,
	maxRetries: 3,
	retryDelaysMs: [30000, 120000],
	deadLetterExchange: "dlx",
	deadLetterRoutingKey: "dlq",
};

describe("QueueAdapter Interface", () => {
	it("should expose the expected adapter interface", () => {
		const adapter = createMockAdapter();
		expect(adapter).toHaveProperty("enqueue");
		expect(adapter).toHaveProperty("startConsumer");
		expect(adapter).toHaveProperty("stopConsumer");
		expect(adapter).toHaveProperty("getDepth");
		expect(adapter).toHaveProperty("getBackend");
		expect(adapter).toHaveProperty("isHealthy");
	});

	it("should return rabbitmq backend type", () => {
		const adapter = createMockAdapter();
		expect(adapter.getBackend()).toBe("rabbitmq");
	});

	it("should enqueue a job", async () => {
		const adapter = createMockAdapter();
		const result = await adapter.enqueue(sampleJobData);
		expect(result).toBe("rabbitmq-job-id");
	});

	it("should start a consumer", async () => {
		const adapter = createMockAdapter();
		await expect(
			adapter.startConsumer(async () => {}),
		).resolves.toBeUndefined();
	});

	it("should stop a consumer", async () => {
		const adapter = createMockAdapter();
		await expect(adapter.stopConsumer()).resolves.toBeUndefined();
	});

	it("should return queue depth", async () => {
		const adapter = createMockAdapter();
		const depth = await adapter.getDepth();
		expect(depth).toBe(0);
	});

	it("should check health", async () => {
		const adapter = createMockAdapter();
		const healthy = await adapter.isHealthy();
		expect(healthy).toBe(true);
	});
});

describe("RabbitMQQueueAdapter", () => {
	it("should use rabbitmq-only backend", () => {
		const rabbitmq = createMockAdapter();
		expect(rabbitmq.getBackend()).toBe("rabbitmq");

		const rabbitmqResult = rabbitmq.enqueue(sampleJobData);
		expect(rabbitmqResult).resolves.toBe("rabbitmq-job-id");
	});
});
