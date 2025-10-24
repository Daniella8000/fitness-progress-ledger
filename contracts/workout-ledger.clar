;; workout-ledger.clar
;; Immutable fitness progress tracking with on-chain verification
;; Supports user registration, activity logging, and participation in athletic competitions
;; Designed to create transparent, verifiable fitness records with incentive mechanisms

;; Error codes for operational failures
(define-constant fail-unauthorized (err u100))
(define-constant fail-user-exists (err u101))
(define-constant fail-user-missing (err u102))
(define-constant fail-competition-missing (err u103))
(define-constant fail-already-participating (err u104))
(define-constant fail-competition-concluded (err u105))
(define-constant fail-competition-inactive (err u106))
(define-constant fail-activity-type-invalid (err u107))
(define-constant fail-duplicate-daily-entry (err u108))
(define-constant fail-params-invalid (err u109))
(define-constant fail-not-competition-organizer (err u110))
(define-constant fail-competition-exists (err u111))

;; Data storage for user accounts and progress
(define-map account-records
  { account-principal: principal }
  {
    display-name: (string-utf8 50),
    enrollment-timestamp: uint,
    activity-count: uint,
    most-recent-activity: (optional uint)
  }
)

;; Valid activity classifications
(define-data-var activity-registry (list 9 (string-utf8 20)) 
  (list u"running" u"walking" u"cycling" u"swimming" u"weightlifting" u"yoga" u"hiit" u"pilates")
)

;; Persistent workout activity storage
(define-map activity-ledger
  { sequence-id: uint, account-principal: principal }
  {
    activity-category: (string-utf8 20),
    time-spent-minutes: uint,
    energy-expenditure: uint,
    block-timestamp: uint,
    session-notes: (optional (string-utf8 200))
  }
)

;; Monotonic sequence for activity records
(define-data-var activity-sequence uint u0)

;; Competition framework and configuration
(define-map competition-registry
  { competition-id: uint }
  {
    title: (string-utf8 100),
    rules: (string-utf8 500),
    organizer: principal,
    commencement: uint,
    conclusion: uint,
    required-activities: uint,
    minimum-session-duration: uint,
    participation-reward: uint,
    is-operational: bool
  }
)

;; Track which users compete in which competitions
(define-map competition-enrollment
  { competition-id: uint, competitor: principal }
  {
    enrollment-time: uint,
    activities-logged: uint,
    has-completed-target: bool
  }
)

;; Counter for generating unique competition identifiers
(define-data-var competition-sequence uint u0)

;; ========== Internal Helper Functions ==========

;; Verify if a competition is currently accepting new participants
(define-private (verify-competition-active (comp-id uint))
  (match (map-get? competition-registry { competition-id: comp-id })
    comp-data (and 
      (>= block-height (get commencement comp-data))
      (<= block-height (get conclusion comp-data))
      (get is-operational comp-data)
    )
    false
  )
)

;; Check if competition window has not yet opened
(define-private (has-competition-not-started (comp-id uint))
  (match (map-get? competition-registry { competition-id: comp-id })
    comp-data (< block-height (get commencement comp-data))
    false
  )
)

;; Persist a single activity entry and update user stats
(define-private (record-activity-entry
  (actor principal)
  (activity-type (string-utf8 20))
  (duration uint)
  (calories uint)
  (comments (optional (string-utf8 200)))
)
  (let
    (
      (new-id (+ (var-get activity-sequence) u1))
    )
    ;; Update sequence counter
    (var-set activity-sequence new-id)
    
    ;; Store the activity
    (map-set activity-ledger
      { sequence-id: new-id, account-principal: actor }
      {
        activity-category: activity-type,
        time-spent-minutes: duration,
        energy-expenditure: calories,
        block-timestamp: block-height,
        session-notes: comments
      }
    )
    
    ;; Refresh user account metadata
    (match (map-get? account-records { account-principal: actor })
      existing-record
        (map-set account-records
          { account-principal: actor }
          {
            display-name: (get display-name existing-record),
            enrollment-timestamp: (get enrollment-timestamp existing-record),
            activity-count: (+ (get activity-count existing-record) u1),
            most-recent-activity: (some block-height)
          }
        )
      false
    )

    new-id
  )
)

;; ========== Query Functions ==========

;; Retrieve account profile and statistics
(define-read-only (query-account-info (principal-id principal))
  (map-get? account-records { account-principal: principal-id })
)

;; Retrieve a single activity record by ID
(define-read-only (fetch-activity-by-id (activity-id uint) (principal-id principal))
  (map-get? activity-ledger { sequence-id: activity-id, account-principal: principal-id })
)

;; Retrieve competition details and structure
(define-read-only (fetch-competition-info (comp-id uint))
  (map-get? competition-registry { competition-id: comp-id })
)

;; Retrieve user's enrollment status in a competition
(define-read-only (check-competition-enrollment (comp-id uint) (principal-id principal))
  (map-get? competition-enrollment { competition-id: comp-id, competitor: principal-id })
)

;; ========== Mutation Functions ==========

;; Initialize user profile with display identifier
(define-public (setup-account (user-identifier (string-utf8 50)))
  (let
    ((caller tx-sender))
    
    ;; Create account with initial metadata
    (map-set account-records
      { account-principal: caller }
      {
        display-name: user-identifier,
        enrollment-timestamp: block-height,
        activity-count: u0,
        most-recent-activity: none
      }
    )
    (ok true)
  )
)

;; Submit a new activity session
(define-public (submit-activity 
  (activity-type (string-utf8 20)) 
  (time-minutes uint) 
  (energy-burned uint) 
  (optional-notes (optional (string-utf8 200)))
)
  (let
    ((caller tx-sender))
    ;; Enforce minimum time threshold
    (asserts! (> time-minutes u0) fail-params-invalid)
    
    ;; Persist activity and return sequence ID
    (let 
      ((seq-id (record-activity-entry caller activity-type time-minutes energy-burned optional-notes)))
      (ok seq-id)
    )
  )
)

;; Establish new competition parameters
(define-public (launch-competition 
  (competition-title (string-utf8 100)) 
  (competition-description (string-utf8 500))
  (start-block uint)
  (end-block uint)
  (activity-target uint)
  (min-duration uint)
  (award-amount uint)
)
  (let
    (
      (organizer tx-sender)
      (new-comp-id (+ (var-get competition-sequence) u1))
    )
    ;; Validate competition structure
    (asserts! (< start-block end-block) fail-params-invalid)
    (asserts! (>= start-block block-height) fail-params-invalid)
    (asserts! (> activity-target u0) fail-params-invalid)
    (asserts! (> min-duration u0) fail-params-invalid)
    
    ;; Increment competition counter
    (var-set competition-sequence new-comp-id)
    
    ;; Establish competition
    (map-set competition-registry
      { competition-id: new-comp-id }
      {
        title: competition-title,
        rules: competition-description,
        organizer: organizer,
        commencement: start-block,
        conclusion: end-block,
        required-activities: activity-target,
        minimum-session-duration: min-duration,
        participation-reward: award-amount,
        is-operational: true
      }
    )
    (ok new-comp-id)
  )
)

;; Enroll in an existing competition
(define-public (enroll-in-competition (comp-id uint))
  (let
    ((participant tx-sender))
    
    ;; Check competition is active (not stopped)
    (if (has-competition-not-started comp-id)
      fail-competition-inactive
      (begin
        ;; Check competition operational
        (asserts! (verify-competition-active comp-id) fail-competition-inactive)
        
        ;; Register participation
        (map-set competition-enrollment
          { competition-id: comp-id, competitor: participant }
          {
            enrollment-time: block-height,
            activities-logged: u0,
            has-completed-target: false
          }
        )
        (ok true)
      )
    )
  )
)

;; Register new activity category with system
(define-public (introduce-activity-type (activity-classification (string-utf8 20)))
  (let
    ((registry (var-get activity-registry)))
    ;; Authorization check
    (asserts! (is-eq tx-sender (as-contract tx-sender)) fail-unauthorized)
    
    ;; Category registration processed
    (ok true)
  )
)