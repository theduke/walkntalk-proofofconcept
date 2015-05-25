"use strict";

var AUTOBAHN_DEBUG = false;

function Shape(options) {
  _.defaults(options, {
    stage: null,

    id: null,
    type: null, // circle or rect

    color: null,

    // size.
    width: null,
    height: null,

    speed: 0,

    // position.
    x: null,
    y: null
  });

  this.stage = options.stage;

  this.id = options.id;
  this.type = options.type;
  this.color = options.color;
  this.width = options.width;
  this.height = options.height;
  this.speed = options.speed;

  var shape = new createjs.Shape();
  shape.graphics.beginFill(options.color);

  if (options.type === 'circle') {
    shape.graphics.drawCircle(0, 0, options.width);
  }
  else if (options.type === 'rect') {
    shape.graphics.drawRect(0, 0, options.width, options.height);
  }
  else {
    throw new Error("Unknown shape type: " + options.type);
  }
  if (options.x && options.y) {
    shape.x = options.x;
    shape.y = options.y;
  }

  this.canvasShape = shape;
}

Shape.prototype.moveTo = function(x, y, speed) {
  var xDiff = Math.abs(x - this.canvasShape.x);
  var yDiff = Math.abs(y - this.canvasShape.y);

  var length = Math.sqrt(xDiff * xDiff + yDiff * yDiff);
  speed = _.isNumber(speed) ? speed : this.speed;
  var duration =  Math.round(length / speed * 1000);

  createjs.Tween.get(this.canvasShape, {override:true}).to({
    x: x,
    y: y
  }, duration);
};

var WT = {

  connection: null,

  playerId: null,

  heartbeatHandle: null,

  stage: null,
  stageWidth: null,
  stageHeight: null,

  shapes: {
    player: null
  },

  init: function() {
    console.log("Initializing walkandtalk.");

    console.log("Show loading spinner");
    new Spinner({color:'black', lines: 12}).spin(document.getElementById('spinner'));

    this.initAutobahn();
  },

  initAutobahn: function() {
    console.log("Initializing autobahn.");
    var that = this;

    var wsuri = "ws://localhost:8080/ws";

    this.connection = new autobahn.Connection({
        url: wsuri,
        realm: "realm1"
     }); 

    this.connection.onopen = function(session, details) {
      that.onAutobahnConnected(session, details);
    }

    this.connection.onclose = function(reason, details) {
      that.onAutobahnClosed(reason, details);
    }

    this.connection.open();
  },

  onAutobahnConnected: function(session, details) {
    console.log("Autobahn connection established.");
    this.initUI();
    this.joinGame();
  },

  onAutobahnClosed: function(reason, details) {
    console.log("Autobahn connection lost", reason, details);
  },

  joinGame: function() {
    var that = this;

    console.log("Trying to register with server...");

    this.connection.session.call('at.theduke.wt.join_game', [{}]).then(function(result) {
      that.onJoined(result);
    }, function(err) {
      console.log("Error while joining game: ", err);
      setTimeout(function() {
        that.joinGame();
      }, 1000);
    });
  },

  onJoined: function(result) {
    var that = this;
    var player = result.player;

    this.playerId = player.playerId;
    console.log("Joined the game with playerId " + this.playerId);

    _.each(result.players, function(p) {
      that.addPlayer(p);
    });

    // Initialize heartbeat interval.
    this.initHeartbeat();

    // Subscribe to all relevant events.
    this.connection.session.subscribe('at.theduke.wt.players_joined', function(result) {
      that.onPlayersJoined(result[0]);
    }).then(
       function (sub) {
       },
       function (err) {
          console.log('Could not subscribe to at.theduke.wt.players_left!', err);
       }
    );

    this.connection.session.subscribe('at.theduke.wt.players_left', function(result) {
      that.onPlayersLeft(result[0]);
    }).then(
       function (sub) {
       },
       function (err) {
          console.log('Could not subscribe to at.theduke.wt.players_left!', err);
       }
    );

    this.connection.session.subscribe('at.theduke.wt.player_positions', function(result) {
      that.onPlayerPositions(result[0]);
    }).then(
       function (sub) {
       },
       function (err) {
          console.log('Could not subscribe to at.theduke.wt.player_positions!', err);
       }
    );
  },

  initHeartbeat: function() {
    var that = this;

    if (that.heartbeatHandle) {
      clearInterval(that.heartbeatHandle);
    }

    that.heartbeatHandle = setInterval(function() {
      console.log("Sending heartbeat...");
      that.connection.session.call('at.theduke.wt.heartbeat', [that.playerId]);
    }, 5000);
  },

  addPlayer: function(player) {
    if (player.playerId in this.shapes) {
      console.log("Ignoring duplicate playerId " + player.playerId);
      return;
    }

    console.log("Adding player " + player.playerId);

    var shape = new Shape({
      id: player.playerId,
      type: 'circle',
      color: player.color,
      width: 10,
      x: player.posX,
      y: player.posY,
      speed: 600
    });
    this.addShape(shape);
  },

  onPlayersJoined: function(players) {
    if (!this.playerId) {
      return;
    }

    var that = this;

    _.each(players, function(p) {
      that.addPlayer(p);
    });
  },

  onPlayersLeft: function(players) {
    if (!this.playerId) {
      return;
    }
    var that = this;

    console.log("Some players left the game: ", players);
    _.each(players, function(id) {
      if (id === this.playerId) {
        console.log("We were kicked out of the game!");
      }

      if (id in this.shapes) {
        console.log("Removing player " + id);
        this.removeShape(this.shapes[playerId]);
      }
    });
  },

  onPlayerPositions: function(positions) {
    if (!this.playerId) {
      return;
    }

    var that = this;

    _.each(positions, function(pos, playerId) {
      if (playerId in that.shapes) {
        console.log("Player " + playerId + ' has moved to ' + pos[0] + '/' + pos[1]);
        that.shapes[playerId].moveTo(pos[0], pos[1]);
      }
      else {
        // Ignoring yet unknown player.
      }
    });
  },

  initUI: function() {
    console.log("Initializing UI.");
    var that = this;

    var wrap = $('#wt-wrap');
    wrap.css('height', $(document).height() + 'px');

    $('#loading').fadeOut(function() {
      $(this).remove();
    });

    this.stageWidth = wrap.width();
    this.stageHeight = wrap.height();
     
    var canvas = $('#canvas');
    canvas.attr('height', this.stageHeight + 'px').attr('width', this.stageWidth + 'px');

    // Create EasleJS stage.
    this.stage  = new createjs.Stage("canvas");

    // Initialize ticker that redraws canvas.
    createjs.Ticker.setFPS(40);
    createjs.Ticker.addEventListener("tick", this.stage);

    this.stage.on("stagemousedown", function(evt) {
      that.onStageMouseDown(evt);
    });
  },

  getStageMiddle: function() {
    return {
      x: this.stageWidth / 2,
      y: this.stageHeight / 2
    };
  },

  onStageMouseDown: function(evt) {
    var shape = this.shapes[this.playerId];
    //shape.moveTo(evt.stageX, evt.stageY);
    this.connection.session.call('at.theduke.wt.player_moved', [{
      playerId: this.playerId,
      x: evt.stageX,
      y: evt.stageY
    }]);
  },

  addShape: function(shape) {
    if (!shape.id) {
      throw new Error("Shape has no id set.");
    }

    this.shapes[shape.id] = shape;
    this.stage.addChild(shape.canvasShape);
  },

  removeShape: function(shape) {
    this.stage.removeChild(shape.canvasShape);
  },

};

window.onload = function() {
  WT.init();
}
