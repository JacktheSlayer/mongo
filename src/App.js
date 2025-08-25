import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom";
import io from "socket.io-client";
import Login from "./Login";
import Dashboard from "./Dashboard";

const socket = io("http://localhost:5000");

export const SocketContext = React.createContext(null);

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || null);
  const [username, setUsername] = useState(
    localStorage.getItem("username") || null
  );

  const login = (token, username) => {
    localStorage.setItem("token", token);
    localStorage.setItem("username", username);
    setToken(token);
    setUsername(username);
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setToken(null);
    setUsername(null);
  };

  if (!token) {
    return <Login onLogin={login} />;
  }

  return (
    <SocketContext.Provider value={socket}>
      <Router>
        <Routes>
          <Route
            path="/"
            element={
              <Dashboard
                token={token}
                username={username}
                logout={logout}
                socket={socket}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </SocketContext.Provider>
  );
}

export default App;
