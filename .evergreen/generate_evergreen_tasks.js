const fs = require('fs');
const yaml = require('js-yaml');

const MONGODB_VERSIONS = ['latest', 'rapid', '6.0', '5.0', '4.4', '4.2', '4.0', '3.6'];
const NODE_VERSIONS = ['erbium', 'fermium', 'gallium'];
NODE_VERSIONS.sort();
const LOWEST_LTS = NODE_VERSIONS[0];
const LATEST_LTS = NODE_VERSIONS[NODE_VERSIONS.length - 1];

const TOPOLOGIES = ['server', 'replica_set', 'sharded_cluster'];
const AWS_AUTH_VERSIONS = ['latest', '6.0', '5.0', '4.4'];
const TLS_VERSIONS = ['latest', '6.0', '5.0', '4.4', '4.2'];

const DEFAULT_OS = 'ubuntu1804-large';

const OPERATING_SYSTEMS = [
  {
    name: 'ubuntu-18.04',
    display_name: 'Ubuntu 18.04',
    run_on: 'ubuntu1804-large'
  },
  {
    name: 'windows-64-vs2019',
    display_name: 'Windows (VS2019)',
    run_on: 'windows-64-vs2019-large',
    msvsVersion: 2019,
    clientEncryption: false // TODO(NODE-3401): Unskip when Windows no longer fails to launch mongocryptd occasionally
  }
].map(osConfig => ({
  nodeVersion: LOWEST_LTS,
  auth: 'auth',
  clientEncryption: true,
  ...osConfig
}));

// TODO: NODE-3060: enable skipped tests on windows
const WINDOWS_SKIP_TAGS = new Set(['atlas-connect', 'auth', 'load_balancer']);

const TASKS = [];
const SINGLETON_TASKS = [];

function makeTask({ mongoVersion, topology, tags = [], auth = 'auth' }) {
  return {
    name: `test-${mongoVersion}-${topology}${auth === 'noauth' ? '-noauth' : ''}`,
    tags: [mongoVersion, topology, ...tags],
    commands: [
      { func: 'install dependencies' },
      {
        func: 'bootstrap mongo-orchestration',
        vars: {
          VERSION: mongoVersion,
          TOPOLOGY: topology,
          AUTH: auth
        }
      },
      { func: 'bootstrap kms servers' },
      { func: 'run tests' }
    ]
  };
}

function generateVersionTopologyMatrix() {
  function* _generate() {
    for (const mongoVersion of MONGODB_VERSIONS) {
      for (const topology of TOPOLOGIES) {
        yield { mongoVersion, topology };
      }
    }
  }

  return Array.from(_generate());
}

const BASE_TASKS = generateVersionTopologyMatrix().map(makeTask);
const AUTH_DISABLED_TASKS = generateVersionTopologyMatrix().map(test =>
  makeTask({ ...test, auth: 'noauth', tags: ['noauth'] })
);

BASE_TASKS.push({
  name: `test-latest-server-v1-api`,
  tags: ['latest', 'server', 'v1-api'],
  commands: [
    { func: 'install dependencies' },
    {
      func: 'bootstrap mongo-orchestration',
      vars: {
        VERSION: 'latest',
        TOPOLOGY: 'server',
        REQUIRE_API_VERSION: '1',
        AUTH: 'auth'
      }
    },
    { func: 'bootstrap kms servers' },
    // TODO(NODE-4642): Fix versioned API tests
    // {
    //   func: 'run tests',
    //   vars: {
    //     MONGODB_API_VERSION: '1'
    //   }
    // }
  ]
});

// manually added tasks
TASKS.push(
  ...[
    {
      name: 'test-atlas-connectivity',
      tags: ['atlas-connect'],
      commands: [{ func: 'install dependencies' }, { func: 'run atlas tests' }]
    },
    {
      name: 'test-atlas-data-lake',
      commands: [
        { func: 'install dependencies' },
        { func: 'bootstrap mongohoused' },
        { func: 'run data lake tests' }
      ]
    },
    {
      name: 'test-5.0-load-balanced',
      tags: ['latest', 'sharded_cluster', 'load_balancer'],
      commands: [
        { func: 'install dependencies' },
        {
          func: 'bootstrap mongo-orchestration',
          vars: {
            VERSION: '5.0',
            TOPOLOGY: 'sharded_cluster',
            AUTH: 'auth',
            LOAD_BALANCER: 'true'
          }
        },
        { func: 'start-load-balancer' },
        { func: 'run-lb-tests' },
        { func: 'stop-load-balancer' }
      ]
    },
    {
      name: 'test-6.0-load-balanced',
      tags: ['latest', 'sharded_cluster', 'load_balancer'],
      commands: [
        { func: 'install dependencies' },
        {
          func: 'bootstrap mongo-orchestration',
          vars: {
            VERSION: '6.0',
            TOPOLOGY: 'sharded_cluster',
            AUTH: 'auth',
            LOAD_BALANCER: 'true'
          }
        },
        { func: 'start-load-balancer' },
        { func: 'run-lb-tests' },
        { func: 'stop-load-balancer' }
      ]
    },
    {
      name: 'test-latest-load-balanced',
      tags: ['latest', 'sharded_cluster', 'load_balancer'],
      commands: [
        { func: 'install dependencies' },
        {
          func: 'bootstrap mongo-orchestration',
          vars: {
            VERSION: 'latest',
            TOPOLOGY: 'sharded_cluster',
            AUTH: 'auth',
            LOAD_BALANCER: 'true'
          }
        },
        { func: 'start-load-balancer' },
        { func: 'run-lb-tests' },
        { func: 'stop-load-balancer' }
      ]
    },
    {
      name: 'test-auth-kerberos',
      tags: ['auth', 'kerberos'],
      commands: [{ func: 'install dependencies' }, { func: 'run kerberos tests' }]
    },
    {
      name: 'test-auth-ldap',
      tags: ['auth', 'ldap'],
      commands: [{ func: 'install dependencies' }, { func: 'run ldap tests' }]
    },
    {
      name: 'test-socks5',
      tags: [],
      commands: [
        { func: 'install dependencies' },
        {
          func: 'bootstrap mongo-orchestration',
          vars: {
            VERSION: 'latest',
            TOPOLOGY: 'replica_set'
          }
        },
        { func: 'bootstrap kms servers' },
        { func: 'run socks5 tests' }
      ]
    },
    {
      name: 'test-socks5-tls',
      tags: [],
      commands: [
        { func: 'install dependencies' },
        {
          func: 'bootstrap mongo-orchestration',
          vars: {
            SSL: 'ssl',
            VERSION: 'latest',
            TOPOLOGY: 'replica_set'
          }
        },
        { func: 'run socks5 tests', vars: { SSL: 'ssl' } }
      ]
    }
  ]
);

for (const compressor of ['zstd', 'snappy']) {
  TASKS.push({
    name: `test-${compressor}-compression`,
    tags: ['latest', compressor],
    commands: [
      { func: 'install dependencies' },
      {
        func: 'bootstrap mongo-orchestration',
        vars: {
          VERSION: 'latest',
          TOPOLOGY: 'replica_set',
          AUTH: 'auth',
          COMPRESSOR: compressor
        }
      },
      { func: 'run-compression-tests' }
    ]
  });
}

const AWS_LAMBDA_HANDLER_TASKS = [];
// Add task for testing lambda example without aws auth.
AWS_LAMBDA_HANDLER_TASKS.push({
  name: 'test-lambda-example',
  tags: ['latest', 'lambda'],
  commands: [
    { func: 'install dependencies' },
    {
      func: 'bootstrap mongo-orchestration',
      vars: {
        VERSION: 'rapid',
        TOPOLOGY: 'server'
      }
    },
    { func: 'run lambda handler example tests' }
  ]
});

// Add task for testing lambda example with aws auth.
AWS_LAMBDA_HANDLER_TASKS.push({
  name: 'test-lambda-aws-auth-example',
  tags: ['latest', 'lambda'],
  commands: [
    { func: 'install dependencies' },
    {
      func: 'bootstrap mongo-orchestration',
      vars: {
        VERSION: 'rapid',
        AUTH: 'auth',
        ORCHESTRATION_FILE: 'auth-aws.json',
        TOPOLOGY: 'server'
      }
    },
    { func: 'add aws auth variables to file' },
    { func: 'setup aws env' },
    { func: 'run lambda handler example tests with aws auth' }
  ]
});

for (const VERSION of TLS_VERSIONS) {
  TASKS.push({
    name: `test-tls-support-${VERSION}`,
    tags: ['tls-support'],
    commands: [
      { func: 'install dependencies' },
      {
        func: 'bootstrap mongo-orchestration',
        vars: {
          VERSION,
          SSL: 'ssl',
          TOPOLOGY: 'server'
          // TODO: NODE-3891 - fix tests broken when AUTH enabled
          // AUTH: 'auth'
        }
      },
      { func: 'run tls tests' }
    ]
  });
}

const AWS_AUTH_TASKS = [];

for (const VERSION of AWS_AUTH_VERSIONS) {
  const name = ex => `aws-${VERSION}-auth-test-${ex.split(' ').join('-')}`;
  const aws_funcs = [
    { func: 'run aws auth test with regular aws credentials' },
    { func: 'run aws auth test with assume role credentials' },
    { func: 'run aws auth test with aws EC2 credentials' },
    { func: 'run aws auth test with aws credentials as environment variables' },
    { func: 'run aws auth test with aws credentials and session token as environment variables' },
    { func: 'run aws ECS auth test' }
  ];

  const aws_tasks = aws_funcs.map(fn => ({
    name: name(fn.func),
    commands: [
      { func: 'install dependencies' },
      {
        func: 'bootstrap mongo-orchestration',
        vars: {
          VERSION: VERSION,
          AUTH: 'auth',
          ORCHESTRATION_FILE: 'auth-aws.json',
          TOPOLOGY: 'server'
        }
      },
      { func: 'add aws auth variables to file' },
      { func: 'setup aws env' },
      fn
    ]
  }));

  TASKS.push(...aws_tasks);
  AWS_AUTH_TASKS.push(...aws_tasks.map(t => t.name));
}

const BUILD_VARIANTS = [];

for (const
  {
    name: osName,
    display_name: osDisplayName,
    run_on,
    nodeVersions = NODE_VERSIONS,
    clientEncryption,
    msvsVersion
  } of OPERATING_SYSTEMS) {
  const testedNodeVersions = NODE_VERSIONS.filter(version => nodeVersions.includes(version));
  const os = osName.split('-')[0];
  const tasks = BASE_TASKS.concat(TASKS)
    .filter(task => {
      const isAWSTask = task.name.match(/^aws/);
      const isSkippedTaskOnWindows = task.tags && os.match(/^windows/) && task.tags.filter(tag => WINDOWS_SKIP_TAGS.has(tag)).length

      return !isAWSTask && !isSkippedTaskOnWindows;
    });

  for (const NODE_LTS_NAME of testedNodeVersions) {
    const nodeLtsDisplayName = `Node ${NODE_LTS_NAME[0].toUpperCase()}${NODE_LTS_NAME.slice(1)}`;
    const name = `${osName}-${NODE_LTS_NAME}`;
    const display_name = `${osDisplayName} ${nodeLtsDisplayName}`;
    const expansions = { NODE_LTS_NAME };
    const taskNames = tasks.map(({ name }) => name);

    if (clientEncryption) {
      expansions.CLIENT_ENCRYPTION = true;
    }
    if (msvsVersion) {
      expansions.MSVS_VERSION = msvsVersion;
    }

    BUILD_VARIANTS.push({ name, display_name, run_on, expansions, tasks: taskNames });
  };
}

BUILD_VARIANTS.push({
  name: 'macos-1100',
  display_name: `MacOS 11 Node ${LATEST_LTS[0].toUpperCase()}${LATEST_LTS.slice(1)}`,
  run_on: 'macos-1100',
  expansions: {
    NODE_LTS_NAME: LATEST_LTS,
    CLIENT_ENCRYPTION: true
  },
  tasks: ['test-rapid-server']
});

// singleton build variant for linting
SINGLETON_TASKS.push(
  ...[
    {
      name: 'run-unit-tests',
      tags: ['run-unit-tests'],
      commands: [
        {
          func: 'install dependencies',
          vars: {
            NODE_LTS_NAME: LOWEST_LTS
          }
        },
        { func: 'run unit tests' }
      ]
    },
    {
      name: 'run-lint-checks',
      tags: ['run-lint-checks'],
      commands: [
        {
          func: 'install dependencies',
          vars: {
            NODE_LTS_NAME: LOWEST_LTS
          }
        },
        { func: 'run lint checks' }
      ]
    },
    {
      name: 'run-typescript-next',
      tags: ['run-typescript-next'],
      commands: [
        {
          func: 'install dependencies',
          vars: {
            NODE_LTS_NAME: LOWEST_LTS
          }
        },
        { func: 'run typescript next' }
      ]
    },
    {
      name: 'run-typescript-current',
      tags: ['run-typescript-current'],
      commands: [
        {
          func: 'install dependencies',
          vars: {
            NODE_LTS_NAME: LOWEST_LTS
          }
        },
        { func: 'run typescript current' }
      ]
    },
    {
      name: 'run-typescript-oldest',
      tags: ['run-typescript-oldest'],
      commands: [
        {
          func: 'install dependencies',
          vars: {
            NODE_LTS_NAME: LOWEST_LTS
          }
        },
        { func: 'run typescript oldest' }
      ]
    }
  ]
);

BUILD_VARIANTS.push({
  name: 'lint',
  display_name: 'lint',
  run_on: DEFAULT_OS,
  tasks: [
    'run-unit-tests',
    'run-lint-checks',
    'run-typescript-current',
    'run-typescript-oldest',
    'run-typescript-next'
  ]
});

// TODO NODE-3897 - generate combined coverage report
// BUILD_VARIANTS.push({
//   name: 'generate-combined-coverage',
//   display_name: 'Generate Combined Coverage',
//   run_on: DEFAULT_OS,
//   tasks: ['download-and-merge-coverage']
// });

// singleton build variant for mongosh integration tests
SINGLETON_TASKS.push({
  name: 'run-mongosh-integration-tests',
  tags: ['run-mongosh-integration-tests'],
  exec_timeout_secs: 3600,
  commands: [
    {
      func: 'install dependencies',
      vars: {
        NODE_LTS_NAME: 'gallium'
      }
    },
    { func: 'run mongosh integration tests' }
  ]
});

BUILD_VARIANTS.push({
  name: 'mongosh_integration_tests',
  display_name: 'mongosh integration tests',
  run_on: 'ubuntu1804-test',
  tasks: ['run-mongosh-integration-tests']
});

// special case for MONGODB-AWS authentication
BUILD_VARIANTS.push({
  name: 'ubuntu1804-test-mongodb-aws',
  display_name: 'MONGODB-AWS Auth test',
  run_on: 'ubuntu1804-test',
  expansions: {
    NODE_LTS_NAME: LOWEST_LTS
  },
  tasks: AWS_AUTH_TASKS
});

const oneOffFuncs = [
  {
    name: 'run-custom-snappy-tests',
    func: 'run custom snappy tests'
  },
  {
    name: 'run-bson-ext-integration',
    func: 'run bson-ext test',
    vars: {
      NODE_LTS_NAME: LOWEST_LTS,
      TEST_NPM_SCRIPT: 'check:test'
    }
  },
  {
    name: 'run-bson-ext-unit',
    func: 'run bson-ext test',
    vars: {
      NODE_LTS_NAME: LOWEST_LTS,
      TEST_NPM_SCRIPT: 'check:unit'
    }
  }
];

const oneOffFuncAsTasks = oneOffFuncs.map(oneOffFunc => ({
  name: oneOffFunc.name,
  tags: ['run-custom-dependency-tests'],
  commands: [
    {
      func: 'install dependencies',
      vars: {
        NODE_LTS_NAME: LOWEST_LTS
      }
    },
    {
      func: 'bootstrap mongo-orchestration',
      vars: {
        VERSION: '5.0',
        TOPOLOGY: 'server',
        AUTH: 'auth'
      }
    },
    oneOffFunc
  ]
}));

for (const version of ['5.0', 'rapid', 'latest']) {
  for (const ref of ['c071d5a8d59ddcad40f22887a12bdb374c2f86af', 'master']) {
    oneOffFuncAsTasks.push({
      name: `run-custom-csfle-tests-${version}-${ref === 'master' ? ref : 'pinned-commit'}`,
      tags: ['run-custom-dependency-tests'],
      commands: [
        {
          func: 'install dependencies',
          vars: {
            NODE_LTS_NAME: LOWEST_LTS
          }
        },
        {
          func: 'bootstrap mongo-orchestration',
          vars: {
            VERSION: version,
            TOPOLOGY: 'replica_set'
          }
        },
        { func: 'bootstrap kms servers' },
        {
          func: 'run custom csfle tests',
          vars: {
            CSFLE_GIT_REF: ref
          }
        }
      ]
    });
  }
}

// TODO NODE-3897 - generate combined coverage report
const coverageTask = {
  name: 'download and merge coverage'.split(' ').join('-'),
  tags: [],
  commands: [
    {
      func: 'download and merge coverage'
    }
  ],
  depends_on: [{ name: '*', variant: '*', status: '*', patch_optional: true }]
};

SINGLETON_TASKS.push(...oneOffFuncAsTasks);

BUILD_VARIANTS.push({
  name: 'ubuntu1804-custom-dependency-tests',
  display_name: 'Custom Dependency Version Test',
  run_on: DEFAULT_OS,
  tasks: oneOffFuncAsTasks.map(({ name }) => name)
});

// special case for serverless testing
BUILD_VARIANTS.push({
  name: 'ubuntu1804-test-serverless',
  display_name: 'Serverless Test',
  run_on: 'ubuntu1804-test',
  expansions: {
    NODE_LTS_NAME: LOWEST_LTS
  },
  tasks: ['serverless_task_group']
});

BUILD_VARIANTS.push({
  name: 'ubuntu1804-no-auth-tests',
  display_name: 'No Auth Tests',
  run_on: DEFAULT_OS,
  expansions: {
    CLIENT_ENCRYPTION: true
  },
  tasks: AUTH_DISABLED_TASKS.map(({ name }) => name)
});

BUILD_VARIANTS.push({
  name: 'ubuntu1804-test-lambda',
  display_name: 'AWS Lambda handler tests',
  run_on: 'ubuntu1804-test',
  tasks: ['test-lambda-example', 'test-lambda-aws-auth-example']
});

// TODO(NODE-4575): unskip zstd and snappy on node 16
for (const variant of BUILD_VARIANTS.filter(
  variant => variant.expansions && variant.expansions.NODE_LTS_NAME === 'gallium'
)) {
  variant.tasks = variant.tasks.filter(
    name => !['test-zstd-compression', 'test-snappy-compression'].includes(name)
  );
}

const fileData = yaml.load(fs.readFileSync(`${__dirname}/config.in.yml`, 'utf8'));
fileData.tasks = (fileData.tasks || [])
  .concat(BASE_TASKS)
  .concat(TASKS)
  .concat(SINGLETON_TASKS)
  .concat(AUTH_DISABLED_TASKS)
  .concat(AWS_LAMBDA_HANDLER_TASKS);
fileData.buildvariants = (fileData.buildvariants || []).concat(BUILD_VARIANTS);

fs.writeFileSync(`${__dirname}/config.yml`, yaml.dump(fileData, { lineWidth: 120 }), 'utf8');
