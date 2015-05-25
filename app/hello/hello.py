###############################################################################
#
# Copyright (C) 2014, Tavendo GmbH and/or collaborators. All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are met:
#
# 1. Redistributions of source code must retain the above copyright notice,
# this list of conditions and the following disclaimer.
#
# 2. Redistributions in binary form must reproduce the above copyright notice,
# this list of conditions and the following disclaimer in the documentation
# and/or other materials provided with the distribution.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
# LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
# CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
# SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
# CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
# ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
# POSSIBILITY OF SUCH DAMAGE.
#
###############################################################################

from datetime import datetime
from pprint import pprint
import random

from twisted.internet.defer import inlineCallbacks

from autobahn.twisted.util import sleep
from autobahn.twisted.wamp import ApplicationSession
from autobahn.wamp.exception import ApplicationError

class Player():

    def __init__(self, playerId, color, posX=0, posY=0):
        self.playerId = playerId
        self.color = color
        self.posX = posX
        self.posY = posY
        self.last_action = None
        self.is_announced = False

    def has_acted(self):
        self.last_action = datetime.now()

    def get_info(self):
        return {
            'posX': self.posX,
            'posY': self.posY,
            'color': self.color,
            'playerId': self.playerId,
        }

class Game():

    def __init__(self ):
        self.playerIndex = 0
        self.players = {}

        self.has_position_updates = False

    def get_player(self, playerId):
        return self.players[playerId] if playerId in self.players else None

    def get_random_color(self):
        r = lambda: random.randint(0,255)
        return '#{:02x}{:02x}{:02x}'.format(r(), r(), r())

    def add_player(self, posX=0, posY=0):
        self.playerIndex += 1
        player  = Player(self.playerIndex, posX=posX, posY=posY, color=self.get_random_color())
        player.has_acted()
        self.players[player.playerId] = player

        return player

    def remove_player(self, playerId):
        player = self.get_player(playerId)
        if player:
            del self.players[player.playerId]

    def purge_players(self):
        now = datetime.now()
        purged_ids = []

        for index, player in self.players.items():
            diff = (now - player.last_action).total_seconds()
            if (now - player.last_action).total_seconds() >= 10:
                playerId = player.playerId
                self.remove_player(playerId)
                purged_ids.append(playerId)

        return purged_ids

    def player_heartbeat(self, playerId):
        player = self.get_player(playerId)
        if player:
            player.has_acted()
            return True

    def player_moved(self, playerId, x, y):
        player = self.get_player(playerId)
        if player:
            player.posX = x
            player.posY = y
            player.has_acted()

            self.has_position_updates = True

    def get_player_positions(self, reset=False):
        if reset:
            self.has_position_updates = False
        return {player.playerId: [player.posX, player.posY] for player in self.players.values()}

    def get_new_players(self, update=False):
        players = []

        for player in self.players.values():
            if not player.is_announced:
                if update:
                    player.is_announced = True
                players.append(player)

        return players

    def get_players_info(self):
        return {player.playerId: player.get_info() for player in self.players.values()}


game = Game()


class AppSession(ApplicationSession):

    def __init__(self, config = None):
        ApplicationSession.__init__(self, config)
        self.traceback_app = True

    @inlineCallbacks
    def onJoin(self, details):

        # SUBSCRIBE to a topic and receive events
        #
        def onhello(msg):
            print("event for 'onhello' received: {}".format(msg))

        sub = yield self.subscribe(onhello, 'com.example.onhello')
        print("subscribed to topic 'onhello': {}".format(sub))

        def player_moved(data):
            global game
            game.player_moved(data['playerId'], data['x'], data['y'])
            print("Player {} moved to {}/{}".format(data['playerId'], data['x'], data['y']))
        player_moved_handle = yield self.register(player_moved, 'at.theduke.wt.player_moved')

        def player_heartbeat(playerId):
            global game
            if game.player_heartbeat(playerId):
                print("Received heartbeat for player {}".format(playerId))
        player_heartbeat_handle = yield self.register(player_heartbeat, 'at.theduke.wt.heartbeat')


        def join_game(player_info):
            global game
            player = game.add_player()

            print("Player {} has joined the game.".format(player.playerId))

            return {
                'player': player.get_info(),
                'players': game.get_players_info()
            }
        join_game_handle = yield self.register(join_game, 'at.theduke.wt.join_game')

        def leave_game(playerId):
            global game
            print("Player {} has left the game.".format(playerId))

            game.remove_player(playerId)
        leave_hame_handle = yield self.register(leave_game, 'at.theduke.wt.leave_game')

        counter = 0
        global game
        while True:
            # Check if any players need to be purged,
            # and if so, send update event.
            purged_ids = game.purge_players()
            if len(purged_ids):
                print("Purged players: " + ','.join([str(x) for x in purged_ids]))
                yield self.publish('at.theduke.wt.players_left', purged_ids)

            new_players = game.get_new_players(True)
            if len(new_players):
                yield self.publish('at.theduke.wt.players_joined', [player.get_info() for player in new_players])

            # send position data if any player has moved.
            if game.has_position_updates:
                positions = game.get_player_positions(reset=True)
                pprint(positions)
                yield self.publish('at.theduke.wt.player_positions', positions)



            yield sleep(0.01)
