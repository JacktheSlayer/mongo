import React, { useState } from "react";
import "./Login.css";

export default function Login({ onLogin }) {
  // Define all state variables here
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Submit handler for form
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const url = isRegister ? "/api/register" : "/api/login";

    try {
      const res = await fetch("http://localhost:5000" + url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || JSON.stringify(data));
      if (!isRegister) {
        onLogin(data.token, data.username);
      } else {
        setIsRegister(false);
        setUsername("");
        setPassword("");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login-container">
      <h2>{isRegister ? "Register" : "Login"}</h2>
      <form onSubmit={submit}>
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit">{isRegister ? "Register" : "Login"}</button>
      </form>
      <button className="toggle-btn" onClick={() => setIsRegister(!isRegister)}>
        {isRegister ? "Already have account? Login" : "No account? Register"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
