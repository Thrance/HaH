'use strict';

var express = require('express'),
	morgan = require('morgan'),
	libpath = require('path'),
	socketio = require('socket.io'),
	liburl = require('url'),
	bodyParser = require('body-parser');

var structures = require('./structures.js'),
	players = require('./players.js'),
	game = require('./game.js'),
	feedback = require('./feedback.js'),
	objectSync = require('./objectSync.js'),
	config = require('../config.json');

var activeGames = structures.activeGames;


// set defaults for config
config.port = config.port || 7878;
config.minPlayers = config.minPlayers || 4;
config.maxPlayers = config.maxPlayers || 12;

// initialize http router
var app = express();

// enable logging
app.use(morgan('dev'));

// get static files from <project>/client
app.use('/static', express.static( libpath.join(__dirname, '../client') ));
app.use('/decks', express.static( libpath.join(__dirname, '../decks') ));

// load the pages that AREN'T the game
app.get('/', require('./status.js'));
app.post('/feedback', bodyParser.json(), feedback.feedbackRequest);

// bootstrap the game page
app.get('/play', function(req,res,next)
{
	if(!req.query.gameId){
		const ab = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijlkmnopqrstuvwxyz0123456789';
		do {
			var id = '';
			for(var i=0; i<16; i++)
				id += ab[ Math.floor(Math.random()*ab.length) ];
		} while(activeGames[id]);
		res.redirect('?gameId='+id);
	}
	else {
		res.sendFile(libpath.join(__dirname, '../client/index.html'));
	}
});

// return 404 on all other requests
app.use(function(req,res,next)
{
	res.status(404).send('404 File Not Found');
});

// start server on configured port
var server = app.listen(config.port, function(){
	console.log('Listening on port', config.port);
});

// set up sockets
var io = socketio(server);
io.on('connection', function(socket)
{
	// get gameId, put socket in correct room
	var url = liburl.parse(socket.request.url, true);
	var gameId = url.query.gameId;

	if(gameId)
	{
		// initialize game
		if(!activeGames[gameId])
			activeGames[gameId] = new structures.Game(gameId);

		// associate socket with game
		socket.gameId = gameId;
		socket.join(gameId+'_clients');
		registerGameListeners(socket);

		// initialize new client
		var game = activeGames[gameId];
		socket.emit('init', game.getCleanTurnOrder(), game.state,
			structures.Deck.blackCardList[game.currentBlackCard],
			game.turnOrder.length > game.czar ? game.turnOrder[game.czar].id : null,
			game.submissions || null
		);
		console.log('Client connected to', socket.gameId);
	}
	else {
		socket.emit('error', 'No gameId specified');
	}
});


function registerGameListeners(socket)
{
	socket.on('error', function(err){
		console.error(err);
	});

	// trigger leave if socket is disconnected
	socket.on('disconnect', function()
	{
		var player = activeGames[this.gameId].playerForSocket(this);
		if(player)
			players.leave.call(this, player.id, player.displayName, player.displayName+' has disconnected.');

		// destroy game when last client disconnects
		if(!this.adapter.rooms[this.gameId+'_clients'])
			delete activeGames[this.gameId];
	});


	// register player events
	socket.on('playerJoinRequest', players.joinRequest);
	socket.on('playerJoinDenied', players.joinDenied);
	socket.on('playerJoin', players.join);
	socket.on('playerLeave', players.leave);
	socket.on('playerKickRequest', players.kickRequest);
	socket.on('playerKickResponse', players.kickResponse);

	// register game events
	socket.on('dealCards', game.dealCards);
	socket.on('roundStart', game.roundStart);
	socket.on('cardSelection', game.cardSelection);
	socket.on('presentSubmission', game.presentSubmission);
	socket.on('winnerSelection', game.winnerSelection);

	// register object sync events
	socket.on('objectUpdate', objectSync.updateTransform);
	/*socket.on('objectUpdate', function(objName, matrix){
		//console.log('objectUpdate', objName, matrix);
		this.to(this.gameId+'_clients').emit('objectUpdate', objName, matrix);
	});*/
}


