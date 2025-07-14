import { safeJoin } from "@uplift-ltd/strings";
import chalk from "chalk";
import log from "loglevel";
import prefix from "loglevel-plugin-prefix";

const logger = log.noConflict();

const colors = {
  TRACE: chalk.magenta,
  DEBUG: chalk.cyan,
  INFO: chalk.blue,
  WARN: chalk.yellow,
  ERROR: chalk.red,
} as const;

prefix.reg(logger);
prefix.apply(logger, {
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

const defaultLogLevel: keyof typeof log.levels = "ERROR";
const envLogLevel = process.env.EGRESS_BUS_LOG_LEVEL;

if (!envLogLevel) {
  logger.disableAll();
} else {
  logger.setDefaultLevel(
    envLogLevel in log.levels
      ? log.levels[envLogLevel as keyof typeof log.levels]
      : defaultLogLevel,
  );
}

export const getLogger = logger.getLogger;
