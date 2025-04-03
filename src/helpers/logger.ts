import log from "loglevel";
import chalk from "chalk";
import prefix from "loglevel-plugin-prefix";
import { safeJoin } from "@uplift-ltd/strings";

const colors = {
  TRACE: chalk.magenta,
  DEBUG: chalk.cyan,
  INFO: chalk.blue,
  WARN: chalk.yellow,
  ERROR: chalk.red,
} as const;

prefix.reg(log);
log.enableAll();

prefix.apply(log, {
  format(level, name, timestamp) {
    const levelUpper = level.toUpperCase();
    const color =
      levelUpper in colors
        ? colors[levelUpper as keyof typeof colors]
        : colors.INFO;

    return safeJoin(" ")(
      timestamp && chalk.white(`[${timestamp}]`),
      color(level),
      chalk.green(`${name}: `),
    );
  },
});

prefix.apply(log.getLogger("critical"), {
  format(level, name, timestamp) {
    return chalk.red.bold(`[${timestamp}] ${level} ${name}:`);
  },
});

const defaultLogLevel: keyof typeof log.levels = "DEBUG";
const envLogLevel = process.env.LOG_LEVEL ?? defaultLogLevel;

log.setDefaultLevel(
  envLogLevel in log.levels
    ? log.levels[envLogLevel as keyof typeof log.levels]
    : defaultLogLevel,
);

export const getLogger = log.getLogger;
