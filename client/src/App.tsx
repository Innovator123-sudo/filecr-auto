import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MusicProvider } from './music/MusicPlayerContext';
import { MusicBar } from './components/MusicBar';
import { CreatorBadge } from './components/CreatorBadge';
import { ErrorBoundary } from './components/ErrorBoundary';

function RouteFallback() {
  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-zinc-700 border-t-emerald-400 animate-spin" />
      <div className="text-xs text-zinc-500">Loading…</div>
    </div>
  );
}

// chunk load can fail on flaky tunnel / Brave shield — retry once before giving up
function lazyRetry<T extends React.ComponentType<any>>(imp: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try { return await imp(); }
    catch (e) {
      console.warn('[lazyRetry] first import failed, retrying', e);
      await new Promise(r => setTimeout(r, 800));
      return await imp();
    }
  });
}

const Home = lazyRetry(() => import('./pages/Home').then(m => ({ default: m.Home })));
const FriendCreate = lazyRetry(() => import('./pages/FriendCreate').then(m => ({ default: m.FriendCreate })));
const FriendJoin = lazyRetry(() => import('./pages/FriendJoin').then(m => ({ default: m.FriendJoin })));
const RoomArena = lazyRetry(() => import('./pages/RoomArena').then(m => ({ default: m.RoomArena })));
const BotSetup = lazyRetry(() => import('./pages/BotSetup').then(m => ({ default: m.BotSetup })));
const BotArena = lazyRetry(() => import('./pages/BotArena').then(m => ({ default: m.BotArena })));
const Results = lazyRetry(() => import('./pages/Results').then(m => ({ default: m.Results })));
const History = lazyRetry(() => import('./pages/Results').then(m => ({ default: m.History })));
const Music = lazyRetry(() => import('./pages/Music').then(m => ({ default: m.Music })));

export default function App() {
  return (
    <ErrorBoundary label="App">
      <BrowserRouter>
        <MusicProvider>
          <ErrorBoundary label="MusicBar">
            <Suspense fallback={<RouteFallback />}>
              <ErrorBoundary label="Routes">
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/friend/create" element={<FriendCreate />} />
                  <Route path="/friend/join" element={<FriendJoin />} />
                  <Route path="/room/:code" element={<RoomArena />} />
                  <Route path="/bot" element={<BotSetup />} />
                  <Route path="/bot/arena" element={<BotArena />} />
                  <Route path="/results/:id" element={<Results />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/music" element={<Music />} />
                </Routes>
              </ErrorBoundary>
            </Suspense>
            <MusicBar />
            <CreatorBadge />
          </ErrorBoundary>
        </MusicProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
