/**
 * Review Queue System
 * Manages human review and approval before blockchain submission
 */

class ReviewQueue {
  constructor() {
    this.pendingReviews = [];
    this.approvedRecords = [];
    this.rejectedRecords = [];
    this.disputedRecords = [];
    this.nextId = 1;
    
    // Reviewer permissions
    this.reviewers = new Map();
    this.adminReviewers = new Set();
  }
  
  /**
   * Generate unique ID for review
   */
  generateId() {
    return `review_${this.nextId++}_${Date.now()}`;
  }
  
  /**
   * Submit owner record for human review
   */
  async submitForReview(ownerData, confidence, submittedBy) {
    // Validate submission
    if (!ownerData || !ownerData.name) {
      throw new Error('Invalid owner data: name required');
    }
    
    if (!confidence) {
      throw new Error('Confidence score required');
    }
    
    const review = {
      id: this.generateId(),
      ownerData: {
        name: ownerData.name,
        birthYear: ownerData.birthYear,
        deathYear: ownerData.deathYear,
        location: ownerData.location,
        documents: ownerData.documents || [],
        enslavedPeople: ownerData.enslavedPeople || [],
        totalCount: ownerData.totalCount || 0,
        familySearchId: ownerData.familySearchId,
        notes: ownerData.notes || ''
      },
      confidence,
      submittedBy,
      submittedAt: new Date().toISOString(),
      status: this.determineInitialStatus(confidence),
      reviewers: [],
      comments: [],
      requiredApprovals: confidence.disputeRisk === 'HIGH' ? 2 : 1, // E requirement
      flags: this.generateFlags(ownerData, confidence),
      version: 1
    };
    
    // Route to appropriate queue
    if (review.status === 'DISPUTED') {
      this.disputedRecords.push(review);
    } else {
      this.pendingReviews.push(review);
    }
    
    console.log(`Review ${review.id} submitted with status: ${review.status}`);
    
    return {
      reviewId: review.id,
      status: review.status,
      requiredApprovals: review.requiredApprovals,
      estimatedReviewTime: this.estimateReviewTime(review)
    };
  }
  
  /**
   * Determine initial review status based on confidence
   */
  determineInitialStatus(confidence) {
    if (confidence.disputeRisk === 'HIGH') {
      return 'DISPUTED';
    } else if (confidence.level === 'GAP' || confidence.level === 'INSUFFICIENT') {
      return 'NEEDS_RESEARCH';
    } else {
      return 'PENDING';
    }
  }
  
  /**
   * Generate flags for potential issues
   */
  generateFlags(ownerData, confidence) {
    const flags = [];
    
    if (confidence.score < 50) {
      flags.push({
        type: 'LOW_CONFIDENCE',
        severity: 'HIGH',
        message: 'Confidence score below threshold - needs additional sources'
      });
    }
    
    if (!ownerData.documents || ownerData.documents.length < 2) {
      flags.push({
        type: 'INSUFFICIENT_SOURCES',
        severity: 'HIGH',
        message: 'Less than 2 primary sources provided'
      });
    }
    
    if (ownerData.totalCount > 50) {
      flags.push({
        type: 'LARGE_CLAIM',
        severity: 'MEDIUM',
        message: 'Large number of enslaved people claimed - verify carefully'
      });
    }
    
    if (!ownerData.location) {
      flags.push({
        type: 'MISSING_LOCATION',
        severity: 'MEDIUM',
        message: 'Location not specified'
      });
    }
    
    return flags;
  }
  
  /**
   * Human reviewer approves, rejects, or requests more research
   */
  async humanApprove(reviewId, reviewerId, decision, notes = '') {
    const review = this.findReview(reviewId);
    
    if (!review) {
      throw new Error(`Review ${reviewId} not found`);
    }
    
    // Check if reviewer already reviewed this
    const existingReview = review.reviewers.find(r => r.reviewer === reviewerId);
    if (existingReview) {
      throw new Error('Reviewer has already reviewed this record');
    }
    
    // Add review decision
    const reviewDecision = {
      reviewer: reviewerId,
      decision, // 'APPROVE' | 'REJECT' | 'REQUEST_MORE_RESEARCH'
      notes,
      timestamp: new Date().toISOString(),
      confidenceAtReview: review.confidence.score
    };
    
    review.reviewers.push(reviewDecision);
    
    // Handle different decision types
    if (decision === 'REQUEST_MORE_RESEARCH') {
      review.status = 'NEEDS_RESEARCH';
      this.moveToNeedsResearch(review);
      return {
        readyForBlockchain: false,
        status: 'NEEDS_RESEARCH',
        message: 'Additional research requested'
      };
    }
    
    if (decision === 'REJECT') {
      const rejections = review.reviewers.filter(r => r.decision === 'REJECT').length;
      if (rejections >= 1) { // Single rejection is enough
        review.status = 'REJECTED';
        this.rejectedRecords.push(review);
        this.removeFromPending(reviewId);
        return {
          readyForBlockchain: false,
          status: 'REJECTED',
          message: 'Record rejected'
        };
      }
    }
    
    // Count approvals
    const approvals = review.reviewers.filter(r => r.decision === 'APPROVE').length;
    
    if (approvals >= review.requiredApprovals) {
      review.status = 'APPROVED';
      review.approvedAt = new Date().toISOString();
      this.approvedRecords.push(review);
      this.removeFromPending(reviewId);
      
      // NOW it can go to blockchain
      return { 
        readyForBlockchain: true,
        status: 'APPROVED',
        blockchainPayload: this.prepareBlockchainSubmission(review),
        message: `Record approved by ${approvals} reviewer(s)`
      };
    }
    
    // Still need more approvals
    return { 
      readyForBlockchain: false,
      status: 'PENDING',
      message: `${approvals}/${review.requiredApprovals} approvals received`
    };
  }
  
  /**
   * Add comment to review
   */
  addComment(reviewId, reviewerId, comment) {
    const review = this.findReview(reviewId);
    
    if (!review) {
      throw new Error(`Review ${reviewId} not found`);
    }
    
    review.comments.push({
      reviewer: reviewerId,
      comment,
      timestamp: new Date().toISOString()
    });
    
    return true;
  }
  
  /**
   * Update owner data after additional research
   */
  updateOwnerData(reviewId, updatedData, updatedBy) {
    const review = this.findReview(reviewId);
    
    if (!review) {
      throw new Error(`Review ${reviewId} not found`);
    }
    
    review.ownerData = {
      ...review.ownerData,
      ...updatedData
    };
    
    review.version++;
    review.lastUpdated = new Date().toISOString();
    review.updatedBy = updatedBy;
    
    // Reset to pending if it was in needs research
    if (review.status === 'NEEDS_RESEARCH') {
      review.status = 'PENDING';
      this.pendingReviews.push(review);
    }
    
    return review;
  }
  
  /**
   * Find review across all queues
   */
  findReview(reviewId) {
    return this.pendingReviews.find(r => r.id === reviewId) ||
           this.disputedRecords.find(r => r.id === reviewId) ||
           this.approvedRecords.find(r => r.id === reviewId) ||
           this.rejectedRecords.find(r => r.id === reviewId);
  }
  
  /**
   * Remove from pending queue
   */
  removeFromPending(reviewId) {
    this.pendingReviews = this.pendingReviews.filter(r => r.id !== reviewId);
    this.disputedRecords = this.disputedRecords.filter(r => r.id !== reviewId);
  }
  
  /**
   * Move to needs research queue
   */
  moveToNeedsResearch(review) {
    this.removeFromPending(review.id);
    // Keep in original queue but mark status
  }
  
  /**
   * Prepare data for blockchain submission
   */
  prepareBlockchainSubmission(review) {
    const ownerData = review.ownerData;
    
    return {
      ancestorName: ownerData.name,
      familySearchId: ownerData.familySearchId || '',
      birthYear: ownerData.birthYear,
      deathYear: ownerData.deathYear,
      location: ownerData.location,
      totalEnslavedCount: ownerData.totalCount,
      namedIndividuals: ownerData.enslavedPeople.filter(p => p.name).length,
      documentHashes: ownerData.documents.map(d => d.hash || d.url),
      confidenceScore: review.confidence.score,
      confidenceLevel: review.confidence.level,
      approvers: review.reviewers.filter(r => r.decision === 'APPROVE').map(r => r.reviewer),
      approvedAt: review.approvedAt,
      submittedBy: review.submittedBy,
      reviewId: review.id,
      metadata: {
        primarySources: review.confidence.primarySources,
        documentTypes: review.confidence.documentTypes,
        version: review.version
      }
    };
  }
  
  /**
   * Estimate review time
   */
  estimateReviewTime(review) {
    const baseTime = 2; // hours
    
    if (review.status === 'DISPUTED') {
      return `${baseTime * 2}-${baseTime * 3} hours`;
    }
    
    if (review.ownerData.documents.length > 5) {
      return `${baseTime + 1}-${baseTime + 2} hours`;
    }
    
    return `${baseTime} hours`;
  }
  
  /**
   * Get all pending reviews for a reviewer
   */
  getPendingReviewsForReviewer(reviewerId) {
    return [...this.pendingReviews, ...this.disputedRecords].filter(review => {
      // Don't show reviews already reviewed by this person
      return !review.reviewers.find(r => r.reviewer === reviewerId);
    });
  }
  
  /**
   * Get review statistics
   */
  getStatistics() {
    return {
      pending: this.pendingReviews.length,
      disputed: this.disputedRecords.length,
      approved: this.approvedRecords.length,
      rejected: this.rejectedRecords.length,
      total: this.pendingReviews.length + this.disputedRecords.length + 
             this.approvedRecords.length + this.rejectedRecords.length,
      averageReviewTime: this.calculateAverageReviewTime()
    };
  }
  
  /**
   * Calculate average time from submission to approval
   */
  calculateAverageReviewTime() {
    if (this.approvedRecords.length === 0) return 0;
    
    const times = this.approvedRecords.map(record => {
      const submitted = new Date(record.submittedAt);
      const approved = new Date(record.approvedAt);
      return (approved - submitted) / (1000 * 60 * 60); // hours
    });
    
    const average = times.reduce((sum, time) => sum + time, 0) / times.length;
    return Math.round(average * 10) / 10; // Round to 1 decimal
  }
  
  /**
   * Export review for record keeping
   */
  exportReview(reviewId) {
    const review = this.findReview(reviewId);
    if (!review) return null;
    
    return {
      ...review,
      exportedAt: new Date().toISOString(),
      exportVersion: '1.0.0'
    };
  }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReviewQueue;
} else if (typeof window !== 'undefined') {
  window.ReviewQueue = ReviewQueue;
}
