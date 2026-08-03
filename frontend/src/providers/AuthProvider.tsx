import React, { createContext, useState, useContext } from 'react';
import { authApi } from '../services/api';

interface AuthContextType {
  token: string | null;
  walletAddress: string | null;
  chain: string | null;
  authenticating: boolean;
  authError: string | null;
  login: (address: string, message: string, signature: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(localStorage.getItem('jwt_token'));
  const [walletAddress, setWalletAddress] = useState<string | null>(localStorage.getItem('fomoclix_wallet_address'));
  const [chain, setChain] = useState<string | null>(localStorage.getItem('fomoclix_auth_chain'));
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const login = async (address: string, message: string, signature: string) => {
    setAuthenticating(true);
    setAuthError(null);
    try {
      // Exchange signature for production JWT token via API
      const result = await authApi.login(address, message, signature);
      if (result && result.jwt_token) {
        setToken(result.jwt_token);
        setWalletAddress(address);
        setChain('evm');
        localStorage.setItem('jwt_token', result.jwt_token);
        localStorage.setItem('fomoclix_wallet_address', address);
        localStorage.setItem('fomoclix_auth_chain', 'evm');
        return true;
      }
      throw new Error('No authentication token returned.');
    } catch (err: any) {
      console.error('[AuthProvider Login Error]', err);
      setAuthError(err?.message || 'Wallet signature authentication failed.');
      return false;
    } finally {
      setAuthenticating(false);
    }
  };

  const logout = () => {
    setToken(null);
    setWalletAddress(null);
    setChain(null);
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('fomoclix_wallet_address');
    localStorage.removeItem('fomoclix_auth_chain');
  };

  return (
    <AuthContext.Provider value={{ token, walletAddress, chain, authenticating, authError, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
