import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { api } from '../api/client.js';

/**
 * useBlockchain — encapsulates MetaMask connection + ethers provider/signer
 * for the ReparationsEscrow contract on Base Mainnet.
 *
 * Returns: { connect, disconnect, state }
 *
 * State shape:
 *   connecting: boolean
 *   connected: boolean
 *   address: string | null
 *   chainId: number | null
 *   config: { contractAddress, abi, chainId, usdcAddress, ... } | null
 *   contract: ethers.Contract | null
 *   usdc: ethers.Contract | null
 *   error: Error | null
 */
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address, address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
];

export function useBlockchain() {
  const [state, setState] = useState({
    connecting: false,
    connected: false,
    address: null,
    chainId: null,
    config: null,
    contract: null,
    usdc: null,
    error: null,
  });

  // Load config once on mount (don't need wallet for this)
  useEffect(() => {
    api.getBlockchainConfig()
      .then(cfg => setState(s => ({ ...s, config: cfg })))
      .catch(err => setState(s => ({ ...s, error: err })));
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setState(s => ({ ...s, error: new Error('MetaMask not detected. Install the MetaMask browser extension.') }));
      return;
    }
    setState(s => ({ ...s, connecting: true, error: null }));
    try {
      const config = state.config || await api.getBlockchainConfig();
      const provider = new ethers.BrowserProvider(window.ethereum);

      // Request account access
      const accounts = await provider.send('eth_requestAccounts', []);
      const address = accounts[0];

      // Check network — request switch to Base if needed
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      const targetChainId = config.chainId || 8453;

      if (currentChainId !== targetChainId) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x' + targetChainId.toString(16) }],
          });
        } catch (switchErr) {
          // If chain not added, add it
          if (switchErr.code === 4902 && config.networkParams) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [config.networkParams],
            });
          } else {
            throw switchErr;
          }
        }
      }

      const signer = await provider.getSigner();
      const contract = new ethers.Contract(config.contractAddress, config.abi, signer);
      const usdc = config.usdcAddress
        ? new ethers.Contract(config.usdcAddress, ERC20_ABI, signer)
        : null;

      setState({
        connecting: false,
        connected: true,
        address,
        chainId: targetChainId,
        config,
        contract,
        usdc,
        error: null,
      });
    } catch (err) {
      setState(s => ({ ...s, connecting: false, error: err }));
    }
  }, [state.config]);

  const disconnect = useCallback(() => {
    setState(s => ({
      ...s,
      connected: false,
      address: null,
      contract: null,
      usdc: null,
    }));
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccountsChanged = (accounts) => {
      if (accounts.length === 0) disconnect();
      else setState(s => ({ ...s, address: accounts[0] }));
    };
    const onChainChanged = () => {
      // Simple approach: force reconnect on chain change
      disconnect();
    };
    window.ethereum.on?.('accountsChanged', onAccountsChanged);
    window.ethereum.on?.('chainChanged', onChainChanged);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccountsChanged);
      window.ethereum.removeListener?.('chainChanged', onChainChanged);
    };
  }, [disconnect]);

  return { state, connect, disconnect };
}
