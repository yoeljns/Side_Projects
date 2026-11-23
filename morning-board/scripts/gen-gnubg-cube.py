# Generates src/data/cubeMidgame.json: middle-game cube decisions judged by GNU Backgammon.
#
#   apt-get install gnubg
#   /usr/games/gnubg -t -q -p scripts/gen-gnubg-cube.py
#
# gnubg plays itself (fast 0-ply, cube off, so games run to the end and visit
# every kind of position). Each position is then judged as a money-game cube
# decision at 2-ply cubeful, and the instructive ones are kept.
import gnubg, json, os, random, sys, time

PLIES = 2
PER_BUCKET = int(os.environ.get('PER_BUCKET', '40'))
MAX_GAMES = int(os.environ.get('MAX_GAMES', '2500'))
OUT = os.path.join(os.getcwd(), 'src', 'data', 'cubeMidgame.json')
random.seed(20261123)

for cmd in ['set player 0 gnubg', 'set player 1 gnubg',
            'set player 0 chequer evaluation plies 0', 'set player 1 chequer evaluation plies 0',
            'set cube use off', 'set jacoby off', 'set automatic game off', 'set display off',
            'set rng mersenne', 'set seed 20261123']:
    gnubg.command(cmd)

def ec(plies):
    return {'cubeful': 1, 'plies': plies, 'deterministic': 1, 'noise': 0.0, 'prune': 1}

def cube_info(owned):
    # player 1 is on roll (board[1]); owned => they hold the cube on 2
    ci = gnubg.cubeinfo(2 if owned else 1, 1 if owned else -1, 1, 0, (0, 0), 0)
    ci['jacoby'] = 0
    return ci

def classify(text):
    t = text.lower()
    if t.startswith('too good'): return 'too-good'
    if t.startswith('no double') or t.startswith('no redouble'):
        return 'no-double' if 'take' in t else None  # skip beaver curiosities
    if t.startswith('double') or t.startswith('redouble'):
        return 'double-take' if 'take' in t else 'double-pass' if 'pass' in t else None
    return None

def pips(side): return sum(n * (i + 1) for i, n in enumerate(side))

def contact(roller, opp):
    # opp's point k is the roller's point 25-k; contact while someone still has to pass an enemy checker
    back = max(i + 1 for i, n in enumerate(roller) if n)
    opp_back = max(i + 1 for i, n in enumerate(opp) if n)
    return back + opp_back > 24

buckets, out, seen = {}, [], set()
def full(): return len(buckets) >= 6 and all(v >= PER_BUCKET for v in buckets.values())

start = time.time()
for game_no in range(MAX_GAMES):
    if full(): break
    gnubg.command('new game' if game_no else 'new session')
    game = gnubg.match(0, 1, 0, 0)['games'][-1]['game']
    taken = 0  # neighbouring positions from one game look alike, so take at most two
    for act in game[4:]:  # nobody doubles in the first two moves each
        if taken >= 2: break
        if act.get('action') != 'move' or 'board' not in act: continue
        pid = act['board']
        if pid in seen: continue
        seen.add(pid)
        opp, roller = gnubg.positionfromid(pid)
        if sum(roller) == 0 or sum(opp) == 0: continue
        if max(i + 1 for i, n in enumerate(roller) if n) <= 6 and max(i + 1 for i, n in enumerate(opp) if n) <= 6 \
           and sum(roller) <= 7 and sum(opp) <= 7:
            continue  # small bearoffs are covered exactly elsewhere
        owned = random.random() < 0.3
        ci = cube_info(owned)
        board = (opp, roller)
        # cheap 0-ply screen first: only near-decisions are worth a 2-ply look
        _, nd0, dt0, _, _, _ = gnubg.cfevaluate(board, ci, ec(0))
        if nd0 < 0.25 and min(dt0, 1.0) - nd0 < -0.2: continue
        _, nd, dt, dp, _, text = gnubg.cfevaluate(board, ci, ec(PLIES))
        action = classify(text)
        if action is None: continue
        double_gap = abs(nd - min(dt, dp))
        take_gap = abs(dt - dp)
        kind = None
        if action in ('double-take', 'double-pass') and 0.05 <= take_gap <= 0.35 and random.random() < 0.45:
            kind = 'take'
        elif action == 'too-good' or 0.04 <= double_gap <= 0.22:
            kind = 'double'
        if kind is None: continue
        bucket = kind + ':' + action
        if buckets.get(bucket, 0) >= PER_BUCKET: continue
        buckets[bucket] = buckets.get(bucket, 0) + 1
        taken += 1
        probs = gnubg.evaluate(board, ci, ec(PLIES))
        out.append({
            'kind': kind, 'roller': list(roller), 'opponent': list(opp),
            'cube': 'roller' if owned else 'centered',
            'noDouble': round(nd, 3), 'doubleTake': round(dt, 3),
            'win': round(probs[0], 3), 'gammon': round(probs[1], 3), 'loseGammon': round(probs[3], 3),
            'action': action, 'race': not contact(roller, opp), 'id': pid,
        })
    if game_no % 20 == 0:
        sys.stderr.write('game %d  %.0fs  %s\n' % (game_no, time.time() - start, buckets))

with open(OUT, 'w') as f:
    f.write('[\n' + ',\n'.join(json.dumps(p, separators=(',', ':')) for p in out) + '\n]\n')
sys.stderr.write('wrote %d positions %s\n' % (len(out), buckets))
