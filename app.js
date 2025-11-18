// Web3 Integration for Reparations Blockchain
class ReparationsBlockchain {
    constructor() {
        this.web3 = null;
        this.contract = null;
        this.account = null;
        this.contractAddress = null; // Will be set after deployment
        this.contractABI = []; // Will be populated from build files
    }

    // Initialize Web3 and connect to MetaMask
    async init() {
        if (typeof window.ethereum !== 'undefined') {
            this.web3 = new Web3(window.ethereum);
            try {
                // Request account access
                await window.ethereum.request({ method: 'eth_requestAccounts' });
                const accounts = await this.web3.eth.getAccounts();
                this.account = accounts[0];
                
                console.log('Connected to account:', this.account);
                this.updateUI();
                return true;
            } catch (error) {
                console.error('User denied account access');
                return false;
            }
        } else {
            console.log('MetaMask not detected');
            this.showMetaMaskWarning();
            return false;
        }
    }

    // Connect to deployed contract
    async connectContract() {
        if (this.contractAddress && this.contractABI.length > 0) {
            this.contract = new this.web3.eth.Contract(this.contractABI, this.contractAddress);
            console.log('Connected to contract at:', this.contractAddress);
        } else {
            console.error('Contract address or ABI not set');
        }
    }

    // Submit ancestry record to blockchain
    async submitAncestryRecord(name, genealogyHash, calculatedReparations, notes) {
        if (!this.contract) {
            throw new Error('Contract not connected');
        }

        try {
            const reparationsInWei = this.web3.utils.toWei(calculatedReparations.toString(), 'ether');
            
            const result = await this.contract.methods
                .submitAncestryRecord(name, genealogyHash, reparationsInWei, notes)
                .send({ from: this.account });
            
            console.log('Ancestry record submitted:', result);
            return result;
        } catch (error) {
            console.error('Error submitting ancestry record:', error);
            throw error;
        }
    }

    // Check if debt is settled
    async isDebtSettled(recordId) {
        if (!this.contract) {
            throw new Error('Contract not connected');
        }

        try {
            const settled = await this.contract.methods.isDebtSettled(recordId).call();
            return settled;
        } catch (error) {
            console.error('Error checking debt status:', error);
            throw error;
        }
    }

    // Get remaining debt
    async getRemainingDebt(recordId) {
        if (!this.contract) {
            throw new Error('Contract not connected');
        }

        try {
            const remainingWei = await this.contract.methods.getRemainingDebt(recordId).call();
            return this.web3.utils.fromWei(remainingWei, 'ether');
        } catch (error) {
            console.error('Error getting remaining debt:', error);
            throw error;
        }
    }

    // Record a payment
    async recordPayment(recordId, recipient, amount, transactionHash) {
        if (!this.contract) {
            throw new Error('Contract not connected');
        }

        try {
            const amountInWei = this.web3.utils.toWei(amount.toString(), 'ether');
            
            const result = await this.contract.methods
                .recordPayment(recordId, recipient, transactionHash)
                .send({ 
                    from: this.account,
                    value: amountInWei
                });
            
            console.log('Payment recorded:', result);
            return result;
        } catch (error) {
            console.error('Error recording payment:', error);
            throw error;
        }
    }

    // Update UI with connection status
    updateUI() {
        const statusElement = document.getElementById('blockchain-status');
        if (statusElement) {
            statusElement.innerHTML = `
                <div class="blockchain-connected">
                    <p>✅ Connected to blockchain</p>
                    <p>Account: ${this.account}</p>
                </div>
            `;
        }
    }

    // Show MetaMask warning
    showMetaMaskWarning() {
        const statusElement = document.getElementById('blockchain-status');
        if (statusElement) {
            statusElement.innerHTML = `
                <div class="blockchain-warning">
                    <p>⚠️ MetaMask not detected</p>
                    <p>Please install MetaMask to use blockchain features</p>
                    <a href="https://metamask.io" target="_blank">Install MetaMask</a>
                </div>
            `;
        }
    }
}

// Initialize blockchain integration when page loads
let reparationsBlockchain;

document.addEventListener('DOMContentLoaded', async () => {
    reparationsBlockchain = new ReparationsBlockchain();
    await reparationsBlockchain.init();
    
    // Add blockchain UI elements to existing page
    addBlockchainUI();
});

// Add blockchain-specific UI elements
function addBlockchainUI() {
    const container = document.querySelector('.container');
    
    // Add blockchain status indicator
    const statusDiv = document.createElement('div');
    statusDiv.id = 'blockchain-status';
    statusDiv.style.position = 'absolute';
    statusDiv.style.top = '80px';
    statusDiv.style.right = '20px';
    statusDiv.style.background = 'rgba(255,255,255,0.9)';
    statusDiv.style.padding = '10px';
    statusDiv.style.borderRadius = '10px';
    statusDiv.style.fontSize = '12px';
    container.appendChild(statusDiv);
    
    // Add submit to blockchain button to existing popup
    const style = document.createElement('style');
    style.textContent = `
        .blockchain-connected {
            color: #27ae60;
        }
        .blockchain-warning {
            color: #e74c3c;
        }
        .blockchain-warning a {
            color: #3498db;
            text-decoration: none;
        }
        .blockchain-submit-btn {
            background: #3498db;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin-top: 15px;
        }
        .blockchain-submit-btn:hover {
            background: #2980b9;
        }
    `;
    document.head.appendChild(style);
}

// Enhanced popup functionality with blockchain integration
function showGenealogyPopupWithBlockchain(person) {
    const popup = document.getElementById('genealogyPopup');
    const overlay = document.getElementById('popupOverlay');
    const content = document.getElementById('popupContent');
    
    const data = person.data;
    
    content.innerHTML = `
        <h2 class="popup-title">${person.name}</h2>
        
        <div class="genealogy-section">
            <h3 class="section-title">Personal Information</h3>
            <div class="info-grid">
                <div class="info-label">Birth Date:</div>
                <div class="info-value">${data.birthDate}</div>
                <div class="info-label">Birth Place:</div>
                <div class="info-value">${data.birthPlace}</div>
                <div class="info-label">Current Residence:</div>
                <div class="info-value">${data.currentResidence}</div>
                <div class="info-label">Occupation:</div>
                <div class="info-value">${data.occupation}</div>
            </div>
        </div>
        
        <div class="genealogy-section">
            <h3 class="section-title">Family</h3>
            <div class="info-grid">
                <div class="info-label">Father:</div>
                <div class="info-value">${data.parents.father}</div>
                <div class="info-label">Mother:</div>
                <div class="info-value">${data.parents.mother}</div>
                <div class="info-label">Spouse:</div>
                <div class="info-value">${data.spouse}</div>
                <div class="info-label">Children:</div>
                <div class="info-value">${data.children}</div>
                <div class="info-label">Siblings:</div>
                <div class="info-value">${data.siblings.join(', ')}</div>
            </div>
        </div>
        
        <div class="family-tree">
            <h3 class="section-title">Grandparents</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div>
                    <h4 style="color: #2980b9; margin-bottom: 10px;">Paternal</h4>
                    <div class="info-grid">
                        <div class="info-label">Grandfather:</div>
                        <div class="info-value">${data.grandparents.paternal.grandfather}</div>
                        <div class="info-label">Grandmother:</div>
                        <div class="info-value">${data.grandparents.paternal.grandmother}</div>
                    </div>
                </div>
                <div>
                    <h4 style="color: #2980b9; margin-bottom: 10px;">Maternal</h4>
                    <div class="info-grid">
                        <div class="info-label">Grandfather:</div>
                        <div class="info-value">${data.grandparents.maternal.grandfather}</div>
                        <div class="info-label">Grandmother:</div>
                        <div class="info-value">${data.grandparents.maternal.grandmother}</div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="genealogy-section">
            <h3 class="section-title">Notes</h3>
            <p style="color: #555; line-height: 1.6;">${data.notes}</p>
        </div>
        
        <div class="genealogy-section">
            <h3 class="section-title">Blockchain Actions</h3>
            <button class="blockchain-submit-btn" onclick="submitToBlockchain('${person.name}')">
                Submit to Blockchain
            </button>
            <p style="font-size: 12px; color: #666; margin-top: 10px;">
                This will create an immutable record on the blockchain
            </p>
        </div>
    `;
    
    overlay.classList.add('active');
    popup.classList.add('active');
}

// Submit genealogy data to blockchain
async function submitToBlockchain(personName) {
    try {
        if (!reparationsBlockchain || !reparationsBlockchain.account) {
            alert('Please connect to MetaMask first');
            return;
        }
        
        // For demo purposes - in real implementation, you'd calculate these values
        const genealogyHash = 'QmExampleIPFSHash123'; // This would be actual IPFS hash
        const calculatedReparations = 50000; // This would be calculated based on ancestry
        const notes = `Genealogy record for ${personName} submitted via web interface`;
        
        const result = await reparationsBlockchain.submitAncestryRecord(
            personName,
            genealogyHash,
            calculatedReparations,
            notes
        );
        
        alert('Successfully submitted to blockchain! Transaction: ' + result.transactionHash);
    } catch (error) {
        console.error('Error submitting to blockchain:', error);
        alert('Error submitting to blockchain: ' + error.message);
    }
}
