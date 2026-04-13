import React, { useState } from 'react';
import { ethers } from 'ethers';
import { useBlockchain } from '../../hooks/useBlockchain.js';
import { api } from '../../api/client.js';
import { useAsyncAction } from '../../hooks/useApi.js';
import { formatUSD } from '../../api/format.js';
import { computeGenealogyHash } from '../../api/genealogyHash.js';

/**
 * BlockchainPanel — connect MetaMask, submit DAA records, make payments.
 * Target: payment-ready at premiere so the first USDC/ETH payment to the
 * ReparationsEscrow contract on Base mainnet can happen live.
 *
 * Flow:
 *   1. Connect wallet (switches network to Base)
 *   2. Enter record ID (from DAA generation, handed off by admin) or submit a new record
 *   3. Choose payment method (USDC or ETH)
 *   4. Pay — USDC requires approve() + depositUSDC(); ETH is a direct depositETH()
 */
export function BlockchainPanel() {
  const { state, connect, disconnect } = useBlockchain();

  if (!state.config) {
    if (state.error) return <div className="state err">Error loading blockchain config: {state.error.message}</div>;
    return <div className="state">Loading blockchain config<span className="blink">_</span></div>;
  }

  return (
    <div className="stack-xl">
      <header>
        <h1 style={{ fontSize: 20, fontWeight: 'normal' }}>Payment</h1>
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          ReparationsEscrow contract on Base Mainnet. Connect MetaMask to submit
          a Debt Acknowledgment Agreement on-chain or pay toward an existing record.
        </div>
      </header>

      <section className="grid-2">
        <Field label="Contract address" value={state.config.contractAddress} mono />
        <Field label="Chain" value={`Base Mainnet (${state.config.chainId || 8453})`} />
        <Field label="USDC address" value={state.config.usdcAddress} mono />
        <Field label="Explorer" value={
          <a
            href={`https://basescan.org/address/${state.config.contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on BaseScan →
          </a>
        } />
      </section>

      {!state.connected ? (
        <section className="box" style={{ textAlign: 'center', padding: 32 }}>
          <button type="button" onClick={connect} disabled={state.connecting}>
            {state.connecting ? 'Connecting...' : 'Connect MetaMask'}
          </button>
          {state.error && <div className="err" style={{ marginTop: 12, fontSize: 12 }}>{state.error.message}</div>}
        </section>
      ) : (
        <>
          <section className="box">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="box-label">Connected wallet</div>
                <div className="mono" style={{ fontSize: 12 }}>{state.address}</div>
              </div>
              <button type="button" onClick={disconnect}>Disconnect</button>
            </div>
          </section>

          <SubmitRecord contract={state.contract} walletAddress={state.address} />
          <MakePayment contract={state.contract} usdc={state.usdc} config={state.config} />
          <ViewRecord />
        </>
      )}
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div className="box">
      <div className="box-label">{label}</div>
      <div style={{ fontFamily: mono ? 'var(--font-mono)' : undefined, fontSize: 12, wordBreak: 'break-all' }}>
        {value || <span className="dimmer">—</span>}
      </div>
    </div>
  );
}

// ReparationsEscrow contract signatures (see contracts/ReparationsEscrow.sol):
//   submitAncestryRecord(string name, string fsId, bytes32 genealogyHash,
//                        uint256 totalReparationsOwed, string notes) → uint256
//   depositReparations(uint256 recordId, address token, uint256 amount) payable
//     — for USDC: token = usdcAddress, msg.value = 0
//     — for ETH:  token = address(0), msg.value = amount
// totalReparationsOwed is denominated in USDC decimals (6), per blockchain.js:148.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const USDC_DECIMALS = 6;

function SubmitRecord({ contract, walletAddress }) {
  const [form, setForm] = useState({ ancestorName: '', fsId: '', totalDebt: '', notes: '' });
  const [computedHash, setComputedHash] = useState(null);

  const [run, actionState] = useAsyncAction(async () => {
    if (!contract) throw new Error('Contract not available');
    // Amount is denominated in USDC decimals (6) to match contract storage.
    const totalOwed = ethers.parseUnits(form.totalDebt || '0', USDC_DECIMALS);
    if (totalOwed === 0n) throw new Error('Reparations amount must be positive');

    // Compute deterministic content hash of the submission payload as the
    // bytes32 genealogyHash. Same content → same hash, no IPFS dependency.
    // See frontend/src/api/genealogyHash.js for the rationale.
    const genealogyHash = await computeGenealogyHash({
      ancestorName: form.ancestorName,
      familySearchId: form.fsId,
      notes: form.notes,
      submitter: (walletAddress || '').toLowerCase(),
      totalReparationsOwedUSDC: form.totalDebt,
    });
    setComputedHash(genealogyHash);

    const tx = await contract.submitAncestryRecord(
      form.ancestorName,
      form.fsId,
      genealogyHash,
      totalOwed,
      form.notes
    );
    const receipt = await tx.wait();
    return { txHash: receipt.hash, receipt, genealogyHash };
  });

  return (
    <section>
      <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
        Submit DAA record on-chain
      </h2>
      <div className="box stack">
        <Input label="Ancestor full name" value={form.ancestorName} onChange={v => setForm({ ...form, ancestorName: v })} />
        <Input label="FamilySearch ID" value={form.fsId} onChange={v => setForm({ ...form, fsId: v })} placeholder="XXXX-XXX" />
        <Input label="Total debt (USDC)" value={form.totalDebt} onChange={v => setForm({ ...form, totalDebt: v })} placeholder="0.00" />
        <Input label="Notes" value={form.notes} onChange={v => setForm({ ...form, notes: v })} />
        <button
          type="button"
          onClick={() => run()}
          disabled={!form.ancestorName || actionState.loading}
        >
          {actionState.loading ? 'Submitting...' : 'Record on blockchain'}
        </button>
        {actionState.error && <div className="err" style={{ fontSize: 12 }}>{actionState.error.message}</div>}
        {actionState.data && (
          <div className="ok stack" style={{ fontSize: 12 }}>
            <div>
              Submitted. Tx: <a
                href={`https://basescan.org/tx/${actionState.data.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >{actionState.data.txHash}</a>
            </div>
            <div className="dim mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
              Genealogy hash committed on-chain: {actionState.data.genealogyHash}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MakePayment({ contract, usdc, config }) {
  const [recordId, setRecordId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('usdc');

  const [payUSDC, usdcState] = useAsyncAction(async () => {
    if (!contract || !usdc) throw new Error('Contract or USDC not initialized');
    const decimals = await usdc.decimals();
    const amountRaw = ethers.parseUnits(amount || '0', decimals);

    // 1. Approve contract to spend USDC
    const approveTx = await usdc.approve(config.contractAddress, amountRaw);
    await approveTx.wait();

    // 2. Deposit USDC via unified depositReparations(recordId, token, amount)
    const depositTx = await contract.depositReparations(
      BigInt(recordId),
      config.usdcAddress,
      amountRaw
    );
    const receipt = await depositTx.wait();
    return { txHash: receipt.hash };
  });

  const [payETH, ethState] = useAsyncAction(async () => {
    if (!contract) throw new Error('Contract not initialized');
    const value = ethers.parseEther(amount || '0');
    // ETH deposit: token = address(0), amount = msg.value
    const tx = await contract.depositReparations(
      BigInt(recordId),
      ZERO_ADDRESS,
      value,
      { value }
    );
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  });

  const busy = usdcState.loading || ethState.loading;
  const err = usdcState.error || ethState.error;
  const result = usdcState.data || ethState.data;

  return (
    <section>
      <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
        Make payment
      </h2>
      <div className="box stack">
        <Input label="Record ID" value={recordId} onChange={setRecordId} placeholder="1" />
        <Input label={`Amount (${method.toUpperCase()})`} value={amount} onChange={setAmount} placeholder="0.00" />
        <div className="row">
          <button
            type="button"
            onClick={() => setMethod('usdc')}
            style={{ borderColor: method === 'usdc' ? 'var(--fg)' : 'var(--border)' }}
          >
            [{method === 'usdc' ? '×' : ' '}] USDC
          </button>
          <button
            type="button"
            onClick={() => setMethod('eth')}
            style={{ borderColor: method === 'eth' ? 'var(--fg)' : 'var(--border)' }}
          >
            [{method === 'eth' ? '×' : ' '}] ETH
          </button>
        </div>
        <button
          type="button"
          onClick={() => (method === 'usdc' ? payUSDC() : payETH())}
          disabled={busy || !recordId || !amount}
        >
          {busy ? 'Paying...' : `Pay ${amount || '0'} ${method.toUpperCase()}`}
        </button>
        {err && <div className="err" style={{ fontSize: 12 }}>{err.message}</div>}
        {result && (
          <div className="ok" style={{ fontSize: 12 }}>
            Payment submitted. Tx: <a
              href={`https://basescan.org/tx/${result.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >{result.txHash}</a>
          </div>
        )}
      </div>
    </section>
  );
}

function ViewRecord() {
  const [id, setId] = useState('');
  const [record, setRecord] = useState(null);
  const [err, setErr] = useState(null);

  async function lookup() {
    setErr(null);
    setRecord(null);
    try {
      const r = await api.getBlockchainRecord(id);
      setRecord(r);
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <section>
      <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
        View on-chain record
      </h2>
      <div className="box stack">
        <Input label="Record ID" value={id} onChange={setId} placeholder="1" />
        <button type="button" onClick={lookup} disabled={!id}>Look up record</button>
        {err && <div className="err" style={{ fontSize: 12 }}>{err.message}</div>}
        {record && (
          <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(record, null, 2)}
          </pre>
        )}
      </div>
    </section>
  );
}

function Input({ label, value, onChange, placeholder }) {
  return (
    <div>
      <div className="box-label">{label}</div>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
