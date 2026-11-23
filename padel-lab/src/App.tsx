import { useState } from 'react';
import { Home } from './components/Home';
import { MatchDetail } from './components/MatchDetail';
import { NewAnalysis } from './components/NewAnalysis';
import { deleteMatch, loadMatches, saveMatch } from './lib/store';

type View = { name: 'home' } | { name: 'new' } | { name: 'match'; id: string };

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [matches, setMatches] = useState(loadMatches);
  const home = () => setView({ name: 'home' });

  if (view.name === 'new') {
    return (
      <NewAnalysis
        onCancel={home}
        onSave={(m) => {
          setMatches(saveMatch(m));
          setView({ name: 'match', id: m.id });
        }}
      />
    );
  }
  const match = view.name === 'match' ? matches.find((m) => m.id === view.id) : undefined;
  if (match) {
    return (
      <MatchDetail
        match={match}
        matches={matches}
        onBack={home}
        onDelete={() => {
          setMatches(deleteMatch(match.id));
          home();
        }}
      />
    );
  }
  return <Home matches={matches} onNew={() => setView({ name: 'new' })} onOpen={(id) => setView({ name: 'match', id })} onChange={setMatches} />;
}
