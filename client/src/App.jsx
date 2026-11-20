import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import AuthPage from './pages/AuthPage.jsx';
import ChatLayout from './pages/ChatLayout.jsx';
import ChatThread from './pages/ChatThread.jsx';

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (user === undefined) {
    return <div className="grid h-dvh place-items-center bg-app text-slate-500">Loading…</div>;
  }
  return user ? children : <Navigate to="/login" replace />;
}

function EmptyPanel() {
  return (
    <div className="grid flex-1 place-items-center bg-panel-2 p-6 text-center">
      <div>
        <div className="text-4xl">💬</div>
        <p className="mt-3 text-slate-600">Select a chat or start a new one.</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <ChatLayout />
              </RequireAuth>
            }
          >
            <Route index element={<EmptyPanel />} />
            <Route path="c/:conversationId" element={<ChatThread />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
