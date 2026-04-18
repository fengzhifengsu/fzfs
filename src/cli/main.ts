import { createCLI } from './index';

const program = createCLI();
program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
