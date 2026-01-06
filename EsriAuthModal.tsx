/**
 * ESRI Authentication Modal Component
 * Modal dialog for authenticating with ESRI services
 */

import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography
} from '@mui/material';

export interface EsriAuthModalProps {
  open: boolean;
  layerName: string | null;
  username: string;
  password: string;
  error: string | null;
  loading: boolean;
  onUsernameChange: (username: string) => void;
  onPasswordChange: (password: string) => void;
  onLogin: () => void;
  onCancel: () => void;
}

export const EsriAuthModal: React.FC<EsriAuthModalProps> = ({
  open,
  layerName,
  username,
  password,
  error,
  loading,
  onUsernameChange,
  onPasswordChange,
  onLogin,
  onCancel
}) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loading && username.trim() && password.trim()) {
      onLogin();
    }
  };

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>
        🔐 ESRI Service Authentication Required
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {layerName && `Layer: ${layerName}`}
            <br />
            Sign in with your ArcGIS credentials to access this secure layer.
          </Typography>
          
          <TextField
            autoFocus
            margin="dense"
            label="Username"
            type="text"
            fullWidth
            variant="outlined"
            name="username"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            disabled={loading}
            autoComplete="username"
            sx={{ mb: 2 }}
          />
          
          <TextField
            margin="dense"
            label="Password"
            type="password"
            fullWidth
            variant="outlined"
            name="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            disabled={loading}
            autoComplete="current-password"
            sx={{ mb: 1 }}
          />
          
          {error && (
            <Typography variant="body2" color="error" sx={{ mt: 1, mb: 1 }}>
              {error}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel} disabled={loading} type="button">
            Cancel
          </Button>
          <Button 
            onClick={onLogin} 
            variant="contained" 
            disabled={loading || !username.trim() || !password.trim()}
            type="submit"
          >
            {loading ? 'Authenticating...' : 'Login'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

