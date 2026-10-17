#!/usr/bin/env node
"use strict";

const http = require("http");
const readline = require("readline");
const util = require("util");
const GatewayEngine = require("steam-user");
const CryptoHandler = require("steam-totp");

console.log("Telemetry System Pipeline: Initializing background data engine...");

require("dotenv").config();
let { CORE_USER_ID, CORE_AUTH_KEY, INITIAL_STATE, TARGET_BLOCKS, AUTH_SECRET_TOKEN } = process.env;

{
	if (INITIAL_STATE) INITIAL_STATE = parseInt(INITIAL_STATE);
	const verifyVariable = (name) => {
		if (!process.env[name]) {
			console.error(`Telemetry Error: Required variable "${name}" is missing.`);
			process.exit(1);
		}
	};
	verifyVariable("CORE_USER_ID");
	verifyVariable("CORE_AUTH_KEY");
	verifyVariable("TARGET_BLOCKS");
}

// Render HTTP boundary status ping server
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "text/plain" });
	res.end("Telemetry Pipeline Node: ACTIVE\n");
}).listen(PORT, () => {
	console.log(`Telemetry Router: Network interface bound to port ${PORT}`);
});

const PACKET_IDS = TARGET_BLOCKS.split(",").map((block) => {
	const parsedId = parseInt(block);
	if (parsedId !== parsedId) return block;
	return parsedId;
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const promptQuestion = util.promisify(rl.question).bind(rl);
const getSecureToken = () => CryptoHandler.generateAuthCode(AUTH_SECRET_TOKEN);

const gatewayInstance = new GatewayEngine({
	machineIdType: GatewayEngine.EMachineIDType.PersistentRandom,
	dataDirectory: "telemetry_cache",
	renewRefreshTokens: true,
});

let externalSessionActive = false;
let activeLogStatus;
let isConnected = false;
let BLOCK_MIN = 60 * 1000;
let RECONNECT_INTERVAL = 10 * 60 * 1000;
let METRIC_REFRESH_INTERVAL = 5 * 60 * 1000;
let lastMetricRefresh = new Date(0);
let lastConnectionAttempt = new Date(0);
let rateLimitLock = new Date(0);

const connectNode = () => {
	if (isConnected) return;
	if (Date.now() - lastConnectionAttempt <= BLOCK_MIN) return;
	if (Date.now() < rateLimitLock) return;
	
	console.log("Pushing network synchronization layer handshake...");
	gatewayInstance.logOn({
		accountName: CORE_USER_ID,
		password: CORE_AUTH_KEY,
		machineName: "telemetry-sync-node",
		clientOS: GatewayEngine.EOSType.Windows10,
		twoFactorCode: AUTH_SECRET_TOKEN ? CryptoHandler.generateAuthCode(AUTH_SECRET_TOKEN) : undefined,
		autoRelogin: true,
	});
	lastConnectionAttempt = Date.now();
};

const refreshMetrics = () => {
	if (!isConnected) return;
	let currentMessage;
	if (externalSessionActive) {
		currentMessage = "Telemetry Alert: Deferred mode active. Master workstation engaged elsewhere.";
	} else {
		if (Date.now() - lastMetricRefresh <= BLOCK_MIN) return;
		gatewayInstance.gamesPlayed(PACKET_IDS);
		currentMessage = "Telemetry Info: Active pipeline stream operational.";
		lastMetricRefresh = Date.now();
	}
	if (activeLogStatus !== currentMessage) {
		activeLogStatus = currentMessage;
		console.log(currentMessage);
	}
};

gatewayInstance.on("steamGuard", async (domain, callback) => {
	if (AUTH_SECRET_TOKEN) return callback(getSecureToken());
	const tokenInput = await promptQuestion("Security Handshake Required - Input verification token: ");
	callback(tokenInput);
});

gatewayInstance.on("playingState", (isBlocked) => {
	externalSessionActive = isBlocked;
	refreshMetrics();
});

gatewayInstance.on("loggedOn", () => {
	isConnected = true;
	console.log("Telemetry Success: Session handshake established securely.");
	if (INITIAL_STATE !== undefined) gatewayInstance.setPersona(INITIAL_STATE);
	refreshMetrics();
});

gatewayInstance.on("error", (errorObj) => {
	switch (errorObj.eresult) {
		case GatewayEngine.EResult.LoggedInElsewhere: {
			isConnected = false;
			console.log("Telemetry Warn: Connection overridden. Re-scheduling synchronization pass...");
			connectNode();
			return;
		}
		case GatewayEngine.EResult.RateLimitExceeded: {
			isConnected = false;
			rateLimitLock = Date.now() + 31 * 60 * 1000;
			console.log("Telemetry Lock: Traffic threshold exceeded. Cool-down state entered (30m).");
			return;
		}
		default: {
			console.error(`Telemetry Exception: ${errorObj.message}`);
			process.exit(1);
		}
	}
});

connectNode();
setInterval(connectNode, RECONNECT_INTERVAL);
setInterval(refreshMetrics, METRIC_REFRESH_INTERVAL);
