import * as yargs from 'yargs';
import * as debug from 'debug';
import * as argvSplit from 'argv-split';

import { spawnDetached } from 'spawn-rx';
import { Observable } from 'rxjs/Observable';
import { TimeoutError } from 'rxjs/util/TimeoutError';

import 'rxjs/add/operator/publish';
import 'rxjs/add/operator/reduce';
import 'rxjs/add/operator/timeout';
import 'rxjs/add/operator/toPromise';

const d = debug('timeout-cli');

const yargsResult = yargs
  .usage(`Usage: timeout-cli -- some-cmd 1 2 3
Execute a command and exit if it doesn't terminate in a certain amount of time`)
  .alias('t', 'timeout')
  .describe('timeout', `is a floating point number with an optional suffix: 's' for
seconds (the default), 'm' for minutes, 'h' for hours or 'd' for days.`)
  .string('timeout')
  .alias('o', 'on-timeout')
  .describe('on-timeout', 'if set, command will be executed when a timeout occurs')
  .string('on-timeout')
  .alias('v', 'version')
  .describe('version', 'Print the current version number and exit')
  .alias('h', 'help');

const argv = yargsResult.argv;

if (argv.version) {
  // tslint:disable-next-line:no-var-requires
  let pkgJson = require('../package.json');
  console.log(`timeout-cli ${pkgJson.version}`);
  process.exit(0);
}

if (argv.help) {
  yargs.showHelp();
  process.exit(0);
}

const multipliers = {
  'm$': 60,
  'h$': 60 * 60,
  'd$': 24 * 60 * 60
};

const numPart = /^[0-9]+(\.[0-9]+)?/;
export function parseTime(time: string): number {
  const m = time.match(numPart);
  if (!m || !m[0]) throw new Error(`${time} can't be parsed!`);

  const multiplier = Object.keys(multipliers).reduce((acc, re) => {
    return time.match(new RegExp(re, 'i')) ? multipliers[re] : acc;
  }, 1);

  return parseFloat(m[0]) * multiplier * 1000/*ms*/;
}

export function spawnNoisyDetached(cmd: string, args: string[], opts?: any): Observable<undefined> {
  let ret = spawnDetached(cmd, args, opts).publish();

  ret.subscribe(
    x => console.log(x), e => console.error(e.message));

  ret.connect();
  return ret.reduce(() => undefined);
}

export async function main(argv: any, _showHelp: (() => void)): Promise<number> {
  let processArgs = argv._;

  const timeoutTime = parseTime(argv.timeout || '30s');
  d(`Executing ${processArgs[0]} and waiting for ${timeoutTime}ms...`);

  try {
    d(JSON.stringify(argv));
    d(JSON.stringify(processArgs));

    await spawnNoisyDetached(processArgs[0], processArgs.slice(1))
      .timeout(timeoutTime)
      .toPromise();
  } catch (e) {
    if (e instanceof TimeoutError) {
      console.error(`Process ${processArgs[0]} timed out after ${timeoutTime}ms`);
      if (argv['on-timeout']) {
        const [cmd, ...args] = argvSplit(argv['on-timeout']);
        spawnDetached(cmd, args).subscribe();
      }

      return -1;
    }

    throw e;
  }

  return 0;
}

main(argv, () => yargs.showHelp())
  .then(n => process.exit(n))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);

    process.exit(-1);
  });