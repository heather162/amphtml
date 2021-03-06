/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

/**
 * @fileoverview This file is executed by Travis (configured via
 * .travis.yml in the root directory) and is the main driver script
 * for running tests.  Execution herein is entirely synchronous, that
 * is, commands are executed on after the other (see the exec
 * function). Should a command fail, this script will then also fail.
 * This script attempts to introduce some granularity for our
 * presubmit checking, via the determineBuildTargets method.
 */
const argv = require('minimist')(process.argv.slice(2));
const atob = require('atob');
const colors = require('ansi-colors');
const config = require('./config');
const minimatch = require('minimatch');
const path = require('path');
const {execOrDie, exec, getStderr, getStdout} = require('./exec');
const {gitDiffColor, gitDiffNameOnlyMaster, gitDiffStatMaster} = require('./git');

const fileLogPrefix = colors.bold(colors.yellow('pr-check.js:'));

/**
 * Starts a timer to measure the execution time of the given function.
 * @param {string} functionName
 * @return {DOMHighResTimeStamp}
 */
function startTimer(functionName) {
  const startTime = Date.now();
  console.log(
      '\n' + fileLogPrefix, 'Running', colors.cyan(functionName) + '...');
  return startTime;
}

/**
 * Stops the timer for the given function and prints the execution time.
 * @param {string} functionName
 * @param {DOMHighResTimeStamp} startTime
 * @return {number}
 */
function stopTimer(functionName, startTime) {
  const endTime = Date.now();
  const executionTime = new Date(endTime - startTime);
  const mins = executionTime.getMinutes();
  const secs = executionTime.getSeconds();
  console.log(
      fileLogPrefix, 'Done running', colors.cyan(functionName),
      'Total time:', colors.green(mins + 'm ' + secs + 's'));
}

/**
 * Executes the provided command and times it. Errors, if any, are printed.
 * @param {string} cmd
 * @return {<Object>} Process info.
 */
function timedExec(cmd) {
  const startTime = startTimer(cmd);
  const p = exec(cmd);
  stopTimer(cmd, startTime);
  return p;
}

/**
 * Executes the provided command and times it. The program terminates in case of
 * failure.
 * @param {string} cmd
 */
function timedExecOrDie(cmd) {
  const startTime = startTimer(cmd);
  execOrDie(cmd);
  stopTimer(cmd, startTime);
}

/**
 * Returns a list of files in the commit range within this pull request (PR)
 * after filtering out commits to master from other PRs.
 * @return {!Array<string>}
 */
function filesInPr() {
  const files = gitDiffNameOnlyMaster();
  const changeSummary = gitDiffStatMaster();
  console.log(fileLogPrefix,
      'Testing the following changes at commit',
      colors.cyan(process.env.TRAVIS_PULL_REQUEST_SHA));
  console.log(changeSummary);
  return files;
}

/**
 * Determines whether the given file belongs to the Validator webui,
 * that is, the 'VALIDATOR_WEBUI' target.
 * @param {string} filePath
 * @return {boolean}
 */
function isValidatorWebuiFile(filePath) {
  return filePath.startsWith('validator/webui');
}

/**
 * Determines whether the given file belongs to the Validator webui,
 * that is, the 'BUILD_SYSTEM' target.
 * @param {string} filePath
 * @return {boolean}
 */
function isBuildSystemFile(filePath) {
  return (filePath.startsWith('build-system') &&
      // Exclude textproto from build-system since we want it to trigger
      // tests and type check.
      path.extname(filePath) != '.textproto' &&
      // Exclude config files from build-system since we want it to trigger
      // the flag config check.
      !isFlagConfig(filePath) &&
      // Exclude the dev dashboard from build-system, since we want it to
      // trigger the devDashboard check
      !isDevDashboardFile(filePath) &&
      // Exclude visual diff files from build-system since we want it to trigger
      // visual diff tests.
      !isVisualDiffFile(filePath))
      // OWNERS.yaml files should trigger build system to run tests
      || isOwnersFile(filePath);
}

/**
 * Determines whether the given file belongs to the validator,
 * that is, the 'VALIDATOR' target. This assumes (but does not
 * check) that the file is not part of 'VALIDATOR_WEBUI'.
 * @param {string} filePath
 * @return {boolean}
 */
function isValidatorFile(filePath) {
  if (filePath.startsWith('validator/')) {
    return true;
  }

  // validator files for each extension
  if (!filePath.startsWith('extensions/')) {
    return false;
  }

  const pathArray = path.dirname(filePath).split(path.sep);
  if (pathArray.length < 2) {
    // At least 2 with ['extensions', '{$name}']
    return false;
  }

  // Validator files take the form of validator-.*\.(html|out|protoascii)
  const name = path.basename(filePath);
  return name.startsWith('validator-') &&
      (name.endsWith('.out') || name.endsWith('.html') ||
       name.endsWith('.protoascii'));
}

/**
 * Determines if the given path has a OWNERS.yaml basename.
 * @param {string} filePath
 * @return {boolean}
 */
function isOwnersFile(filePath) {
  return path.basename(filePath) === 'OWNERS.yaml';
}

/**
 * Determines if the given file is a markdown file containing documentation.
 * @param {string} filePath
 * @return {boolean}
 */
function isDocFile(filePath) {
  return path.extname(filePath) == '.md' && !filePath.startsWith('examples/');
}

/**
 * Determines if the given file is related to the visual diff tests.
 * @param {string} filePath
 * @return {boolean}
 */
function isVisualDiffFile(filePath) {
  const filename = path.basename(filePath);
  return (filename == 'visual-diff.js' ||
          filename == 'visual-tests' ||
          filePath.startsWith('examples/visual-tests/'));
}

/**
 * Determines if the given file is a unit test.
 * @param {string} filePath
 * @return {boolean}
 */
function isUnitTest(filePath) {
  return config.unitTestPaths.some(pattern => {
    return minimatch(filePath, pattern);
  });
}

/**
 * Determines if the given file is,
 * a file concerning the dev dashboard
 * Concerning the dev dashboard
 * @param {string} filePath
 * @return {boolean}
 */
function isDevDashboardFile(filePath) {
  return (filePath === 'build-system/app.js' ||
  filePath.startsWith('build-system/app-index/'));
}

/**
 * Determines if the given file is an integration test.
 * @param {string} filePath
 * @return {boolean}
 */
function isIntegrationTest(filePath) {
  return config.integrationTestPaths.some(pattern => {
    return minimatch(filePath, pattern);
  });
}

/**
 * Determines if the given file contains flag configurations, by comparing it
 * against the well-known json config filenames for prod and canary.
 * @param {string} filePath
 * @return {boolean}
 */
function isFlagConfig(filePath) {
  const filename = path.basename(filePath);
  return (filename == 'prod-config.json' || filename == 'canary-config.json');
}

/**
 * Determines the targets that will be executed by the main method of
 * this script. The order within this function matters.
 * @param {!Array<string>} filePaths
 * @return {!Set<string>}
 */
function determineBuildTargets(filePaths) {
  if (filePaths.length == 0) {
    return new Set([
      'BUILD_SYSTEM',
      'VALIDATOR_WEBUI',
      'VALIDATOR',
      'RUNTIME',
      'UNIT_TEST',
      'DEV_DASHBOARD',
      'INTEGRATION_TEST',
      'DOCS',
      'FLAG_CONFIG',
      'VISUAL_DIFF']);
  }
  const targetSet = new Set();
  for (let i = 0; i < filePaths.length; i++) {
    const p = filePaths[i];
    if (isBuildSystemFile(p)) {
      targetSet.add('BUILD_SYSTEM');
    } else if (isValidatorWebuiFile(p)) {
      targetSet.add('VALIDATOR_WEBUI');
    } else if (isValidatorFile(p)) {
      targetSet.add('VALIDATOR');
    } else if (isDocFile(p)) {
      targetSet.add('DOCS');
    } else if (isFlagConfig(p)) {
      targetSet.add('FLAG_CONFIG');
    } else if (isUnitTest(p)) {
      targetSet.add('UNIT_TEST');
    } else if (isDevDashboardFile(p)) {
      targetSet.add('DEV_DASHBOARD');
    } else if (isIntegrationTest(p)) {
      targetSet.add('INTEGRATION_TEST');
    } else if (isVisualDiffFile(p)) {
      targetSet.add('VISUAL_DIFF');
    } else {
      targetSet.add('RUNTIME');
    }
  }
  return targetSet;
}

function startSauceConnect() {
  process.env['SAUCE_USERNAME'] = 'amphtml';
  process.env['SAUCE_ACCESS_KEY'] = getStdout('curl --silent ' +
      'https://amphtml-sauce-token-dealer.appspot.com/getJwtToken').trim();
  const startScCmd = 'build-system/sauce_connect/start_sauce_connect.sh';
  console.log('\n' + fileLogPrefix,
      'Starting Sauce Connect Proxy:', colors.cyan(startScCmd));
  execOrDie(startScCmd);
}

function stopSauceConnect() {
  const stopScCmd = 'build-system/sauce_connect/stop_sauce_connect.sh';
  console.log('\n' + fileLogPrefix,
      'Stopping Sauce Connect Proxy:', colors.cyan(stopScCmd));
  execOrDie(stopScCmd);
}

const command = {
  testBuildSystem: function() {
    timedExecOrDie('gulp ava');
    timedExecOrDie('node node_modules/jest/bin/jest.js');
  },
  testDocumentLinks: function() {
    timedExecOrDie('gulp check-links');
  },
  cleanBuild: function() {
    timedExecOrDie('gulp clean');
  },
  runLintCheck: function() {
    timedExecOrDie('gulp lint');
  },
  runJsonCheck: function() {
    timedExecOrDie('gulp caches-json');
    timedExecOrDie('gulp json-syntax');
  },
  buildCss: function() {
    timedExecOrDie('gulp css');
  },
  buildRuntime: function() {
    timedExecOrDie('gulp build');
  },
  buildRuntimeMinified: function(extensions) {
    let cmd = 'gulp dist --fortesting';
    if (!extensions) {
      cmd = cmd + ' --noextensions';
    }
    timedExecOrDie(cmd);
  },
  runBundleSizeCheck: function(storeBundleSize = false) {
    let cmd = 'gulp bundle-size';
    if (storeBundleSize) {
      cmd += ' --store';
    }
    timedExecOrDie(cmd);
  },
  runDepAndTypeChecks: function() {
    timedExecOrDie('gulp dep-check');
    timedExecOrDie('gulp check-types');
  },
  runUnitTests: function() {
    let cmd = 'gulp test --unit --nobuild';
    if (argv.files) {
      cmd = cmd + ' --files ' + argv.files;
    }
    // Unit tests with Travis' default chromium in coverage mode.
    timedExecOrDie(cmd + ' --headless --coverage');
    if (process.env.TRAVIS) {
      // A subset of unit tests on other browsers via sauce labs
      cmd = cmd + ' --saucelabs_lite';
      startSauceConnect();
      timedExecOrDie(cmd);
      stopSauceConnect();
    }
  },
  runUnitTestsOnLocalChanges: function() {
    timedExecOrDie('gulp test --nobuild --headless --local-changes');
  },
  runDevDashboardTests: function() {
    timedExecOrDie('gulp test --dev_dashboard --nobuild');
  },
  runIntegrationTests: function(compiled, coverage) {
    // Integration tests on chrome, or on all saucelabs browsers if set up
    let cmd = 'gulp test --integration --nobuild';
    if (argv.files) {
      cmd = cmd + ' --files ' + argv.files;
    }
    if (compiled) {
      cmd += ' --compiled';
    }
    if (process.env.TRAVIS) {
      if (coverage) {
        timedExecOrDie(cmd + ' --headless --coverage');
      } else {
        startSauceConnect();
        timedExecOrDie(cmd + ' --saucelabs');
        stopSauceConnect();
      }
    } else {
      timedExecOrDie(cmd + ' --headless');
    }
  },
  runSinglePassCompiledIntegrationTests: function() {
    timedExecOrDie('rm -R dist');
    timedExecOrDie('gulp dist --fortesting --single_pass --pseudo_names');
    timedExecOrDie('gulp test --integration --nobuild --headless '
        + '--compiled --single_pass');
    timedExecOrDie('rm -R dist');
  },
  runVisualDiffTests: function(opt_mode) {
    if (process.env.TRAVIS) {
      process.env['PERCY_TOKEN'] = atob(process.env.PERCY_TOKEN_ENCODED);
    } else if (!process.env.PERCY_PROJECT || !process.env.PERCY_TOKEN) {
      console.log(
          '\n' + fileLogPrefix, 'Could not find environment variables',
          colors.cyan('PERCY_PROJECT'), 'and',
          colors.cyan('PERCY_TOKEN') + '. Skipping visual diff tests.');
      return;
    }
    let cmd = 'gulp visual-diff --nobuild';
    if (opt_mode === 'empty') {
      cmd += ' --empty';
    } else if (opt_mode === 'master') {
      cmd += ' --master';
    }
    const {status} = timedExec(cmd);
    if (status != 0) {
      console.error(fileLogPrefix, colors.red('ERROR:'),
          'Found errors while running', colors.cyan(cmd));
    }
  },
  verifyVisualDiffTests: function() {
    if (!process.env.PERCY_PROJECT || !process.env.PERCY_TOKEN) {
      console.log(
          '\n' + fileLogPrefix, 'Could not find environment variables',
          colors.cyan('PERCY_PROJECT'), 'and',
          colors.cyan('PERCY_TOKEN') +
          '. Skipping verification of visual diff tests.');
      return;
    }
    timedExec('gulp visual-diff --verify_status');
  },
  runPresubmitTests: function() {
    timedExecOrDie('gulp presubmit');
  },
  buildValidatorWebUI: function() {
    timedExecOrDie('gulp validator-webui');
  },
  buildValidator: function() {
    timedExecOrDie('gulp validator');
  },
  updatePackages: function() {
    timedExecOrDie('gulp update-packages');
  },
};

function runAllCommands() {
  // Run different sets of independent tasks in parallel to reduce build time.
  if (process.env.BUILD_SHARD == 'unit_tests') {
    command.updatePackages();
    command.testBuildSystem();
    command.cleanBuild();
    command.buildRuntime();
    command.runVisualDiffTests(/* opt_mode */ 'master');
    command.runLintCheck();
    command.runJsonCheck();
    command.runDepAndTypeChecks();
    command.runUnitTests();
    command.runDevDashboardTests();
    command.runIntegrationTests(/* compiled */ false, /* coverage */ true);
    command.verifyVisualDiffTests();
    // command.testDocumentLinks() is skipped during push builds.
    command.buildValidatorWebUI();
    command.buildValidator();
  }
  if (process.env.BUILD_SHARD == 'integration_tests') {
    command.updatePackages();
    command.cleanBuild();
    command.buildRuntimeMinified(/* extensions */ true);
    // Disable bundle-size check on release branch builds.
    if (process.env['TRAVIS_BRANCH'] === 'master') {
      command.runBundleSizeCheck(/* storeBundleSize */ true);
    }
    command.runPresubmitTests();
    command.runIntegrationTests(/* compiled */ true, /* coverage */ false);
    command.runSinglePassCompiledIntegrationTests();
  }
}

function runAllCommandsLocally() {
  // These tasks don't need a build. Run them first and fail early.
  command.testBuildSystem();
  command.runLintCheck();
  command.runJsonCheck();
  command.runDepAndTypeChecks();
  command.testDocumentLinks();

  // Build if required.
  if (!argv.nobuild) {
    command.cleanBuild();
    command.buildRuntime();
    command.buildRuntimeMinified(/* extensions */ false);
    command.runBundleSizeCheck();
  }

  // These tests need a build.
  command.runPresubmitTests();
  command.runVisualDiffTests();
  command.runUnitTests();
  command.runIntegrationTests(/* compiled */ false, /* coverage */ false);
  command.verifyVisualDiffTests();

  // Validator tests.
  command.buildValidatorWebUI();
  command.buildValidator();
}

/**
 * Makes sure package.json and yarn.lock are in sync.
 */
function runYarnIntegrityCheck() {
  const yarnIntegrityCheck = getStderr('yarn check --integrity').trim();
  if (yarnIntegrityCheck.includes('error')) {
    console.error(fileLogPrefix, colors.red('ERROR:'),
        'Found the following', colors.cyan('yarn'), 'errors:\n' +
        colors.cyan(yarnIntegrityCheck));
    console.error(fileLogPrefix, colors.red('ERROR:'),
        'Updates to', colors.cyan('package.json'),
        'must be accompanied by a corresponding update to',
        colors.cyan('yarn.lock'));
    console.error(fileLogPrefix, colors.yellow('NOTE:'),
        'To update', colors.cyan('yarn.lock'), 'after changing',
        colors.cyan('package.json') + ',', 'run',
        '"' + colors.cyan('yarn install') + '"',
        'and include the updated', colors.cyan('yarn.lock'),
        'in your PR.');
    process.exit(1);
  }
}

/**
 * Makes sure that yarn.lock was properly updated.
 */
function runYarnLockfileCheck() {
  const localChanges = gitDiffColor();
  if (localChanges.includes('yarn.lock')) {
    console.error(fileLogPrefix, colors.red('ERROR:'),
        'This PR did not properly update', colors.cyan('yarn.lock') + '.');
    console.error(fileLogPrefix, colors.yellow('NOTE:'),
        'To fix this, sync your branch to', colors.cyan('upstream/master') +
        ', run', colors.cyan('gulp update-packages') +
        ', and push a new commit containing the changes.');
    console.error(fileLogPrefix, 'Expected changes:');
    console.log(localChanges);
    process.exit(1);
  }
}

/**
 * The main method for the script execution which much like a C main function
 * receives the command line arguments and returns an exit status.
 * @return {number}
 */
function main() {
  const startTime = startTimer('pr-check.js');

  // Make sure package.json and yarn.lock are in sync and up-to-date.
  runYarnIntegrityCheck();
  runYarnLockfileCheck();

  // Run the local version of all tests.
  if (!process.env.TRAVIS) {
    process.env['LOCAL_PR_CHECK'] = true;
    console.log(fileLogPrefix, 'Running all pr-check commands locally.');
    runAllCommandsLocally();
    stopTimer('pr-check.js', startTime);
    return 0;
  }

  console.log(
      fileLogPrefix, 'Running build shard',
      colors.cyan(process.env.BUILD_SHARD),
      '\n');

  if (process.env.TRAVIS_EVENT_TYPE === 'push') {
    console.log(fileLogPrefix, 'Running all commands on push build.');
    runAllCommands();
    stopTimer('pr-check.js', startTime);
    return 0;
  }
  const files = filesInPr();
  const buildTargets = determineBuildTargets(files);

  // Exit early if flag-config files are mixed with runtime files.
  if (buildTargets.has('FLAG_CONFIG') && buildTargets.has('RUNTIME')) {
    console.log(fileLogPrefix, colors.red('ERROR:'),
        'Looks like your PR contains',
        colors.cyan('{prod|canary}-config.json'),
        'in addition to some other files.  Config and code are not kept in',
        'sync, and config needs to be backwards compatible with code for at',
        'least two weeks.  See #8188');
    const nonFlagConfigFiles = files.filter(file => !isFlagConfig(file));
    console.log(fileLogPrefix, colors.red('ERROR:'),
        'Please move these files to a separate PR:',
        colors.cyan(nonFlagConfigFiles.join(', ')));
    stopTimer('pr-check.js', startTime);
    process.exit(1);
  }

  console.log(
      fileLogPrefix, 'Detected build targets:',
      colors.cyan(Array.from(buildTargets).sort().join(', ')));

  // Run different sets of independent tasks in parallel to reduce build time.
  if (process.env.BUILD_SHARD == 'unit_tests') {
    command.updatePackages();
    if (buildTargets.has('BUILD_SYSTEM') ||
        buildTargets.has('RUNTIME')) {
      command.testBuildSystem();
    }
    command.runLintCheck();
    if (buildTargets.has('DOCS')) {
      command.testDocumentLinks();
    }
    if (buildTargets.has('DEV_DASHBOARD')) {
      command.runDevDashboardTests();
    }
    if (buildTargets.has('RUNTIME') ||
        buildTargets.has('UNIT_TEST') ||
        buildTargets.has('INTEGRATION_TEST') ||
        buildTargets.has('BUILD_SYSTEM')) {
      command.cleanBuild();
      command.buildCss();
      command.runJsonCheck();
      command.runDepAndTypeChecks();
      // Run unit tests only if the PR contains runtime or build-system changes.
      if (buildTargets.has('RUNTIME') ||
          buildTargets.has('BUILD_SYSTEM')) {
        // Before running all tests, run tests modified by the PR. (Fail early.)
        command.runUnitTestsOnLocalChanges();
        command.runUnitTests();
      } else if (buildTargets.has('UNIT_TEST')) {
        // PR contains only test changes. Run just the modified unit tests.
        command.runUnitTestsOnLocalChanges();
      }
    }
  }

  if (process.env.BUILD_SHARD == 'integration_tests') {
    command.updatePackages();
    if (buildTargets.has('INTEGRATION_TEST') ||
        buildTargets.has('RUNTIME') ||
        buildTargets.has('VISUAL_DIFF') ||
        buildTargets.has('FLAG_CONFIG') ||
        buildTargets.has('BUILD_SYSTEM')) {
      command.cleanBuild();
      command.buildRuntime();
      command.runVisualDiffTests();
      if (buildTargets.has('RUNTIME')) {
        command.buildRuntimeMinified(/* extensions */ false);
        command.runBundleSizeCheck();
      }
    } else {
      // Generates a blank Percy build to satisfy the required Github check.
      command.runVisualDiffTests(/* opt_mode */ 'empty');
    }
    command.runPresubmitTests();
    if (buildTargets.has('INTEGRATION_TEST') ||
        buildTargets.has('RUNTIME') ||
        buildTargets.has('BUILD_SYSTEM')) {
      command.runIntegrationTests(/* compiled */ false, /* coverage */ true);
      command.runIntegrationTests(/* compiled */ false, /* coverage */ false);
    }
    if (buildTargets.has('INTEGRATION_TEST') ||
        buildTargets.has('RUNTIME') ||
        buildTargets.has('VISUAL_DIFF') ||
        buildTargets.has('FLAG_CONFIG') ||
        buildTargets.has('BUILD_SYSTEM')) {
      command.verifyVisualDiffTests();
    }
    if (buildTargets.has('VALIDATOR_WEBUI')) {
      command.buildValidatorWebUI();
    }
    if (buildTargets.has('VALIDATOR')) {
      command.buildValidator();
    }
    if (buildTargets.has('INTEGRATION_TEST') ||
        buildTargets.has('RUNTIME') ||
        buildTargets.has('BUILD_SYSTEM')) {
      command.runSinglePassCompiledIntegrationTests();
    }
  }

  stopTimer('pr-check.js', startTime);
  return 0;
}

process.exit(main());
