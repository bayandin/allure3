import { readFileSync } from "node:fs";
import process, { argv } from "node:process";

import { Builtins, Cli } from "clipanion";

const [node, app, ...args] = argv;

const pkg: { name: string; description: string; version: string } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const cli = new Cli({
  binaryName: pkg.name,
  binaryLabel: `${node} ${app}`,
  binaryVersion: pkg.version,
});

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);

const run = async () => {
  if (args[0] === "awesome") {
    const { AwesomeCommand } = await import("./commands/awesome.js");

    cli.register(AwesomeCommand);
    return await cli.run(args);
  }

  const {
    AgentCommand,
    AGENT_TASK_MAP_HELP,
    AgentCapabilitiesCommand,
    AgentInspectCommand,
    AgentLatestCommand,
    AgentQueryCommand,
    AgentSelectCommand,
    AgentStateDirCommand,
    Allure2Command,
    AwesomeCommand,
    CheckCommand,
    ClassicCommand,
    CsvCommand,
    DashboardCommand,
    GenerateCommand,
    GitlabGenerateCommand,
    HistoryCommand,
    JiraClearCommand,
    LogCommand,
    OpenCommand,
    QualityGateCommand,
    ResultsPackCommand,
    ResultsUnpackCommand,
    RunCommand,
    SlackCommand,
    TestOpsPlanCommand,
    TestPlanCommand,
    WatchCommand,
    isAgentTaskMapHelpRequest,
  } = await import("./commands/index.js");

  cli.register(AwesomeCommand);
  cli.register(Allure2Command);
  cli.register(AgentCapabilitiesCommand);
  cli.register(AgentInspectCommand);
  cli.register(AgentLatestCommand);
  cli.register(AgentQueryCommand);
  cli.register(AgentSelectCommand);
  cli.register(AgentStateDirCommand);
  cli.register(AgentCommand);
  cli.register(CheckCommand);
  cli.register(ClassicCommand);
  cli.register(CsvCommand);
  cli.register(DashboardCommand);
  cli.register(GenerateCommand);
  cli.register(HistoryCommand);
  cli.register(JiraClearCommand);
  cli.register(LogCommand);
  cli.register(OpenCommand);
  cli.register(QualityGateCommand);
  cli.register(RunCommand);
  cli.register(SlackCommand);
  cli.register(TestOpsPlanCommand);
  cli.register(TestPlanCommand);
  cli.register(WatchCommand);
  cli.register(ResultsPackCommand);
  cli.register(ResultsUnpackCommand);
  cli.register(GitlabGenerateCommand);

  const exitCode = await cli.run(args);

  if (exitCode === 0 && isAgentTaskMapHelpRequest(args)) {
    process.stdout.write(`\n${AGENT_TASK_MAP_HELP}`);
  }

  return exitCode;
};

void run()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

export { type Config as AllureConfig, defineConfig } from "@allurereport/plugin-api";
export { defaultChartsConfig } from "@allurereport/charts-api";
