#! /usr/bin/env node

var tls = require('tls');
var net = require('net');
var eos = require('end-of-stream');
var through = require('through2');
var minimist = require('minimist');
var allContainers = require('docker-allcontainers');
var statsFactory = require('docker-stats');
var logFactory = require('docker-loghose');
var Logentries = require('./leapi');

function connect(opts) {
  var stream;
  if (opts.secure) {
    stream = tls.connect(443, 'data.logentries.com', onSecure);
  } else {
    stream = net.createConnection(80, 'data.logentries.com');
  }

  function onSecure() {
    // let's just crash if we are not secure
    if (!stream.authorized) throw new Error('secure connection not authorized');
  }

  return stream;
}


function start(opts) {
  var logsToken = opts.logstoken || opts.token;
  var statsToken = opts.statstoken || opts.token;
  var out;
  var noRestart = function() {};
  var filter = through.obj(function(obj, enc, cb) {
    addAll(opts.add, obj);

    if (obj.line) {
      this.push(logsToken);
    } else {
      this.push(statsToken);
    }

    this.push(' ');
    this.push(JSON.stringify(obj));
    this.push('\n');
    cb()
  });
  var events = allContainers(opts);
  opts.events = events;

  var loghose = logFactory(opts);
  loghose.pipe(filter);

  if (opts.stats !== false) {
    var stats = statsFactory(opts);
    stats.pipe(filter);
  }

  pipe();

  // destroy out if loghose is destroyed
  eos(loghose, function() {
    noRestart()
    out.destroy();
  });

  return loghose;

  function addAll(proto, obj) {
    if (!proto) { return; }

    var key;
    for (key in proto) {
      if (proto.hasOwnProperty(key)) {
        obj[key] = proto[key];
      }
    }
  }

  function pipe() {
    if (out) {
      filter.unpipe(out);
    }

    out = connect(opts);

    filter.pipe(out, { end: false });

    // automatically reconnect on socket failure
    noRestart = eos(out, pipe);
  }
}

function getTokens(loghost, logname, accountKey, done) {
  var leApi = Logentries({accountKey: accountKey});
  var tokens = {};
  var stop;

  leApi.getHost(loghost, gotHost);

  function gotHost(err, result) {
    if (err || !result.logs) {
      console.dir(result);
      console.error('Could not look up host: %s', err.message);
      return leApi.registerHost(loghost, gotNewHost);
    }
    result.logs.forEach(function (log) {
      if (log.name === logname) {
        tokens.logs = log.token;
      }
      else if (log.name === logname + " stats") {
        tokens.stats = log.stats;
      }
    });
    console.dir(tokens);
    if (!tokens.logs) makeLog(result.key, logname, cb);
    if (!tokens.stats) makeStatsLog(result.key, logname, cb);
  }

  function gotNewHost(err, result) {
    if (err) return done(err);
    makeLog(result.key, logname, cb);
    makeStatsLog(result.key, logname, cb);
  }

  function makeLog(hostKey, name, next) {
    leApi.createLog(name, "token", hostKey, function (err, result) {
      if (err) return next(err);
      tokens.logs = result.token;
    });
  }

  function makeStatsLog(hostKey, name, next) {
    leApi.createLog(name + " stats", "token", hostKey, function (err, result) {
      if (err) return next(err);
      tokens.stats = result.token;
    });
  }

  function cb(err) {
    if (stop) return;
    if (err) {
      stop = true;
      return done(err);
    }
    if (tokens.logs && tokens.stats) return done(null, tokens);
  }
}

function cli() {
  var argv = minimist(process.argv.slice(2), {
    boolean: ['json', 'stats'],
    alias: {
      'token': 't',
      'logstoken': 'l',
      'statstoken': 'k',
      'loghost': 'h',
      'logname': 'n',
      'secure': 's',
      'json': 'j',
      'add': 'a'
    },
    default: {
      json: false,
      stats: true,
      add: []
    }
  });

  if (!(argv.token || (argv.logstoken && argv.statstoken) || (argv.loghost && argv.logname && argv.acct))) {
    console.log('Usage: docker-logentries [-l LOGSTOKEN] [-k STATSTOKEN]\n' +
                '                         [-h LOGHOST] [-n LOGNAME]\n' +
                '                         [-t TOKEN] [--secure] [--json]\n' +
                '                         [--no-stats] [-a KEY=VALUE]');
    process.exit(1);
  }

  if (argv.add && !Array.isArray(argv.add)) {
    argv.add = [argv.add];
  }

  argv.add = argv.add.reduce(function(acc, arg) {
    arg = arg.split('=');
    acc[arg[0]] = arg[1];
    return acc
  }, {});

  if (argv.logname && argv.loghost && argv.acct) {
    getTokens(argv.loghost, argv.logname, argv.acct, function (err, tokens) {
      if (err) throw err;
      console.log('Got tokens: %s %s', tokens.logs, tokens.stats);
      argv.logstoken = tokens.logs;
      argv.statstoken = tokens.stats;
      start(argv);
    });
  }
  else start(argv);
}

cli();
