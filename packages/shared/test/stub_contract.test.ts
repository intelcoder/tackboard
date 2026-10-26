import { runApiContract } from "../test-support/api_contract.ts";
import { startStubDaemon } from "../test-support/stub_daemon.ts";

runApiContract("stub", startStubDaemon);
