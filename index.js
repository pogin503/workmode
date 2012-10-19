var fs = require('fs');
var puts = require('sys').puts;

var bakExtension = ".bak.workmode"
  , startTag = "### workmode blacklist start ###"
  , endTag = "### workmode blacklist end ###"
  ;

function createIfNeeded (file){
  if (!fs.existsSync(file)){
    try{
      puts("Creating `" + file + "`.");
      fs.writeFileSync(file,"");
    } catch (e){
      puts("The file `" + file + "` does not exist and could not be created.");
      puts(e);
      process.exit();
    }
  }
}

function readHosts (hostsPath) {
  createIfNeeded(hostsPath);
  try {
    var hosts = fs.readFileSync(hostsPath);
  } catch (e) {
      puts('Error while reading hosts file: ' + hostsPath);
      puts(e);    
      process.exit()
  }
  return hosts.toString();
};

function backup (source, target) {
  var hosts = readHosts(source);
  try{
    fs.writeFileSync( target, hosts);
  } catch (e){
    puts("The backup file could not be created.")
    puts(e);    
    process.exit()
  }
}


function getSurroundings(hosts){
  var blStart, blEnd, before, after;
  blStart = hosts.indexOf(startTag);
  blEnd = hosts.indexOf(endTag);
  
  if(blStart === -1) {
    // Filter out the entries of the old format (they are extracted in parseHosts).
    before = hosts.split('\n')
      .filter(function(line){
        if (line.match(" # workmode")) {
          return false;
        } else {
          return true;
        }
      })
      .join('\n') + '\n';
    after = endTag + "\n\n";
  } else {
    before = hosts.substring(0,blStart);
    after = hosts.substring(blEnd);
  }
  return {before:before, after:after};
}

function WorkMode(hostsPath){
  this.hostsPath = hostsPath || 'hosts';
  this.parseHosts(readHosts(this.hostsPath))
  if (this.firstTime) {
    backup(this.hostsPath, this.hostsPath + bakExtension + ".firstTime");
    this.writeHosts();
  }
  return this;
}

WorkMode.prototype.writeHosts = function() {
  backup(this.hostsPath, this.hostsPath + bakExtension);
  var prefix = this.prefix;
  var list = this.list.map(function(domain){return prefix + "127.0.0.1 " + domain});
  list.unshift(startTag);
  list.push("");
  list = list.join("\n");
  // Re-read the hosts file in case it has been modified in the mean time.
  // This is overly paranoid, and still not completely bullet-proof, since the 
  // file could be modified between this read and the write that follows, but
  // it's better than nothing.
  var surr = getSurroundings(readHosts(this.hostsPath));
  try {
    fs.writeFileSync(this.hostsPath, surr.before + list + surr.after);
  } catch (e) {
    puts('Error while writing hosts file: `' + this.hostsPath + '`.');
    puts('Fortunately, a backup file had been created: `' + this.hostsPath + bakExtension + '`.');
    puts(e);
    process.exit();
  }
};

WorkMode.prototype.parseHosts = function(hosts){
  var blStart, blEnd, before, list, after;
  blStart = hosts.indexOf(startTag);
  blEnd = hosts.indexOf(endTag);
  
  if(blStart === -1) {
    this.firstTime = true;
    // No blacklist, at least in the new format.
    // Check for the entries in the old one.
    list = hosts.split('\n')
      .filter(function(line){
        if (line.match(" # workmode")) {
          return true;
        } else {
          return false;
        }
      })
      .map(function(line){
        return line.replace(/.*127\.0\.0\.1 /,"").replace(/ # workmode.*/,"");
      });
      this.prefix = "# ";
      this.list = list;
      return;
  } else {
    list = hosts.substring(blStart,blEnd).split("\n").slice(1,-1);
  }
  if (list.length > 0) {
    this.prefix = list[0][0] === '#' ? '# ' : '';
  } else {
    // If the list is empty, we insert the new entries commented out.
    this.prefix = "# ";
  }
  var regex = new RegExp(this.prefix + "127\\.0\\.0\\.1 (.+)");
  list = list.map(function(line) {
    return line.match(regex)[1];
  });
    this.list = list;  
};

WorkMode.prototype.enabled = function () {
  return !(this.list.length === 0 || this.prefix === "# ");
};

WorkMode.prototype.stop = function() {
  if (this.list.length === 0) {
    return 'The blacklist is empty.';
  }
  if (this.enabled()) {
    list = this.prefix = "# ";
    return 'Workmode is now disabled.';
  } else {
    return "Workblock isn't running.";
  }
};

WorkMode.prototype.start = function() {
  if (this.list.length === 0) {
    return '$The blacklist is empty.';
  }
  if (!this.enabled()) {
    this.prefix = "";
    return 'Workmode is now enabled.';
  } else {
    return '$Workmode is already running.';
  }
};

WorkMode.prototype.add = function(domain) {
  if(this.list.indexOf(domain) !== -1) {
    return "$Domain `" + domain + '` is already blacklisted.';
  } else {
    this.list.push(domain);
    this.list.sort();
    return "Domain `" + domain + '` has been added to the blacklist.'; 
  }

};
WorkMode.prototype.displayList = function() {
  return this.list.map(function(domain, index) {
    return index+1 + '. ' + domain;
  }).join('\n');
};

WorkMode.prototype.remove = function(domain) {
  // param is either a domain or an index.
  var index, numeric
  if(parseInt(domain) == domain) {
    // It's an index.
    index = parseInt(domain)-1;
    domain = this.list[index];
    numeric = true;
  } else {
    index = this.list.indexOf(domain);
    numeric = false;
  }
  if(-1 < index && index <= this.list.length) {
    this.list.splice(index,1)
    return "Domain `" + domain + "` has been removed the blacklist.";
  } else {
    return (numeric ? "Index `" + (index + 1) : "Domain `" + domain) + "` was not found in the blacklist.";
  }
}

function parseError(msg) {
  if (msg[0] !== "$") return false;
  return msg.slice(1);
}

WorkMode.prototype.commandLine = function() {
  var self = this;
  var program = require('commander');
  program
    .version('0.2.1')
    .option('status', "Tells whether Workmode is active.")
    .option('start', "Enables the black list. Off to work!")
    .option('stop', "Disbles the black list.")
    .option('add [domain]', "Adds the domain to the black list.")
    .option('remove [index|domain]', "Removes one the domain at the given index. "
                                   + "If no parameter is passed, displays the blacklist "
                                   + "and prompts for one.")
    .option('list', 'Displays the blacklist.');

  program.on('stop', function() {
    var error, msg = self.stop();
    if (!(error = parseError(msg))) {
      self.writeHosts();
    }
    puts(error || msg);
  });

  program.on('start', function() {
    var error, msg = self.start();
    if (!(error = parseError(msg))) {
      self.writeHosts();
    }
    puts(error || msg);
  });

  program.on('status', function() {
    if (self.list.length == 0) {
      puts('The blacklist is empty.');
    } else if (self.enabled()) {
      puts('Workmode is enabled.');
    } else {
      puts('Workmode is disabled.');
    }
  });

  program.on('add', function() {
    if (program.add !== true) {
      var error, msg = self.add(program.add);
      if (!(error = parseError(msg))) {
        self.writeHosts();
      }
      puts(error || msg);      
    }
    else puts("Please specify a domain.");
  });

  program.on('remove', function() {
    var prompt;
    if(program.remove !== true) {
      //  Dummy prompt if a parameter was passed.
      prompt = function(_, cb){
        cb(program.remove)
      }
    } else {
      prompt = function(msg, cb){
        puts(self.displayList());
        program.prompt(msg,cb)
      }
    }
    prompt('Which domain you want to remove: ', function(remove){
      var error, msg = self.remove(remove);
      if (!(error = parseError(msg))) {
        self.writeHosts();
      }
      puts(error || msg);
      process.exit();
    });
  });

  program.on('import', function(src) {
    src = src[0];
    if (!src) {
      puts("Please specify an input file.");
    } else{
      fs.readFileSync(src)
        .toString()
        .split('\n')
        .filter(function (line) {
          if (line.match(/^( |\t)*$/)) return false;
          else return true;
        })
        .map(function (domain) {
          // Strip white space
          domain = domain.replace(/ |\t/g,'')
          // Ensure uniqueness
          if (self.list.indexOf(domain) === -1){
          console.log(domain);
            self.list.push(domain);
          }
        });
      self.writeHosts();
    }
  });

  program.on('export', function(dest) {
    dest = dest[0];
    var out = self.list.join('\n');
    if (!dest) {
      puts(out);
    } else{
      puts("exporting to `" + dest +"`.");
      fs.writeFileSync(dest, out);
    }
  });


  program.on('list', function(){
    puts(self.displayList());
  });

  program.parse(process.argv);

};

module.exports = WorkMode;