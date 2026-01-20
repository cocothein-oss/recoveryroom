use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use switchboard_solana::{
    prelude::*,
    VrfAccountData,
    VrfRequestRandomness,
    OracleQueueAccountData,
    PermissionAccountData,
    SbState,
    SWITCHBOARD_PROGRAM_ID,
};

declare_id!("RecovRoomVRF111111111111111111111111111111");

/// Recovery Room Protocol - Verifiable Fair Lottery using Switchboard VRF
///
/// The protocol runs hourly rounds where users submit their "rugged" tokens.
/// Winner selection uses sqrt-weighted probabilities with on-chain VRF.

#[program]
pub mod recovery_room {
    use super::*;

    /// Initialize the protocol with admin settings
    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        round_duration: i64,        // Duration in seconds (3600 = 1 hour)
        min_loss_percentage: u8,    // Minimum loss % required (e.g., 80)
        max_tokens_per_user: u8,    // Max tokens per participation (e.g., 3)
    ) -> Result<()> {
        let protocol = &mut ctx.accounts.protocol_state;

        protocol.authority = ctx.accounts.authority.key();
        protocol.round_duration = round_duration;
        protocol.min_loss_percentage = min_loss_percentage;
        protocol.max_tokens_per_user = max_tokens_per_user;
        protocol.current_round = 0;
        protocol.total_rounds_completed = 0;
        protocol.bump = ctx.bumps.protocol_state;

        msg!("Recovery Room Protocol initialized");
        Ok(())
    }

    /// Start a new round (called hourly by crank/automation)
    pub fn start_round(ctx: Context<StartRound>) -> Result<()> {
        let protocol = &mut ctx.accounts.protocol_state;
        let round = &mut ctx.accounts.round_state;
        let clock = Clock::get()?;

        // Verify previous round is complete (if any)
        require!(
            protocol.current_round == 0 || ctx.accounts.previous_round.is_some(),
            RecoveryRoomError::PreviousRoundNotComplete
        );

        protocol.current_round += 1;

        round.round_id = protocol.current_round;
        round.start_time = clock.unix_timestamp;
        round.end_time = clock.unix_timestamp + protocol.round_duration;
        round.total_participants = 0;
        round.total_token_entries = 0;
        round.status = RoundStatus::Active;
        round.vrf_result = None;
        round.winner_token = None;
        round.bump = ctx.bumps.round_state;

        emit!(RoundStarted {
            round_id: round.round_id,
            start_time: round.start_time,
            end_time: round.end_time,
        });

        msg!("Round {} started", round.round_id);
        Ok(())
    }

    /// User participates with their losing tokens (max 3)
    pub fn participate(
        ctx: Context<Participate>,
        token_entries: Vec<TokenEntry>,
    ) -> Result<()> {
        let protocol = &ctx.accounts.protocol_state;
        let round = &mut ctx.accounts.round_state;
        let participation = &mut ctx.accounts.participation;
        let clock = Clock::get()?;

        // Validations
        require!(
            round.status == RoundStatus::Active,
            RecoveryRoomError::RoundNotActive
        );
        require!(
            clock.unix_timestamp < round.end_time,
            RecoveryRoomError::RoundEnded
        );
        require!(
            token_entries.len() > 0 && token_entries.len() <= protocol.max_tokens_per_user as usize,
            RecoveryRoomError::InvalidTokenCount
        );

        // Store participation
        participation.user = ctx.accounts.user.key();
        participation.round_id = round.round_id;
        participation.tokens = token_entries.clone();
        participation.timestamp = clock.unix_timestamp;
        participation.bump = ctx.bumps.participation;

        // Update round stats
        round.total_participants += 1;
        round.total_token_entries += token_entries.len() as u32;

        // Update token pool stats (increment submission counts)
        for entry in &token_entries {
            // Find or create token pool entry
            let pool_entry = ctx.accounts.token_pool_entries
                .iter_mut()
                .find(|p| p.token_mint == entry.token_mint);

            if let Some(pool) = pool_entry {
                pool.submission_count += 1;
            }
            // Note: In production, you'd use a separate instruction to register tokens
        }

        emit!(UserParticipated {
            round_id: round.round_id,
            user: ctx.accounts.user.key(),
            token_count: token_entries.len() as u8,
        });

        msg!("User participated with {} tokens", token_entries.len());
        Ok(())
    }

    /// Request VRF randomness when round ends (called by crank)
    pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
        let round = &mut ctx.accounts.round_state;
        let clock = Clock::get()?;

        // Verify round has ended
        require!(
            clock.unix_timestamp >= round.end_time,
            RecoveryRoomError::RoundNotEnded
        );
        require!(
            round.status == RoundStatus::Active,
            RecoveryRoomError::InvalidRoundStatus
        );
        require!(
            round.total_token_entries > 0,
            RecoveryRoomError::NoParticipants
        );

        // Update status
        round.status = RoundStatus::VrfRequested;

        // Request randomness from Switchboard VRF
        let vrf = ctx.accounts.vrf.load()?;
        let oracle_queue = ctx.accounts.oracle_queue.load()?;

        // Build VRF request
        let request_randomness_ctx = VrfRequestRandomness {
            authority: ctx.accounts.protocol_state.to_account_info(),
            vrf: ctx.accounts.vrf.to_account_info(),
            oracle_queue: ctx.accounts.oracle_queue.to_account_info(),
            queue_authority: ctx.accounts.queue_authority.to_account_info(),
            data_buffer: ctx.accounts.data_buffer.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            escrow: ctx.accounts.escrow.clone(),
            payer_wallet: ctx.accounts.payer_wallet.to_account_info(),
            payer_authority: ctx.accounts.payer.to_account_info(),
            recent_blockhashes: ctx.accounts.recent_blockhashes.to_account_info(),
            program_state: ctx.accounts.switchboard_program_state.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };

        // Sign with protocol PDA
        let protocol_seeds = &[
            b"protocol".as_ref(),
            &[ctx.accounts.protocol_state.bump],
        ];
        let signer_seeds = &[&protocol_seeds[..]];

        request_randomness_ctx.invoke_signed(
            ctx.accounts.switchboard_program.to_account_info(),
            signer_seeds,
        )?;

        emit!(VrfRequested {
            round_id: round.round_id,
            timestamp: clock.unix_timestamp,
        });

        msg!("VRF randomness requested for round {}", round.round_id);
        Ok(())
    }

    /// Consume VRF result and determine winner (callback from Switchboard)
    pub fn consume_randomness(ctx: Context<ConsumeRandomness>) -> Result<()> {
        let round = &mut ctx.accounts.round_state;

        require!(
            round.status == RoundStatus::VrfRequested,
            RecoveryRoomError::InvalidRoundStatus
        );

        // Get VRF result
        let vrf = ctx.accounts.vrf.load()?;
        let result_buffer = vrf.get_result()?;

        require!(
            result_buffer != [0u8; 32],
            RecoveryRoomError::VrfNotResolved
        );

        // Convert VRF result to u128 for weighted selection
        let vrf_value = u128::from_le_bytes(result_buffer[0..16].try_into().unwrap());

        // Store VRF result
        round.vrf_result = Some(result_buffer);

        // Calculate winner using sqrt-weighted selection
        let winner_token = select_winner_sqrt_weighted(
            &ctx.accounts.token_pool,
            vrf_value,
        )?;

        round.winner_token = Some(winner_token);
        round.status = RoundStatus::Complete;

        // Update protocol stats
        let protocol = &mut ctx.accounts.protocol_state;
        protocol.total_rounds_completed += 1;

        emit!(RoundComplete {
            round_id: round.round_id,
            winner_token,
            vrf_result: result_buffer,
        });

        msg!("Round {} complete! Winner: {:?}", round.round_id, winner_token);
        Ok(())
    }
}

/// Select winner using sqrt-weighted probabilities
/// Weight = sqrt(submissions), Probability = weight / total_weight
fn select_winner_sqrt_weighted(
    token_pool: &Account<TokenPool>,
    vrf_value: u128,
) -> Result<Pubkey> {
    let mut total_weight: f64 = 0.0;
    let mut weights: Vec<(Pubkey, f64)> = Vec::new();

    // Calculate sqrt weights for each token
    for entry in &token_pool.entries {
        if entry.submission_count > 0 {
            let weight = (entry.submission_count as f64).sqrt();
            total_weight += weight;
            weights.push((entry.token_mint, weight));
        }
    }

    require!(total_weight > 0.0, RecoveryRoomError::NoParticipants);

    // Normalize VRF to 0-1 range
    let normalized = (vrf_value as f64) / (u128::MAX as f64);
    let target = normalized * total_weight;

    // Find winning token
    let mut accumulated = 0.0;
    for (token, weight) in weights {
        accumulated += weight;
        if target <= accumulated {
            return Ok(token);
        }
    }

    // Fallback to last token (shouldn't happen with proper math)
    Ok(token_pool.entries.last().unwrap().token_mint)
}

// ============ Account Structures ============

#[account]
pub struct ProtocolState {
    pub authority: Pubkey,
    pub round_duration: i64,
    pub min_loss_percentage: u8,
    pub max_tokens_per_user: u8,
    pub current_round: u64,
    pub total_rounds_completed: u64,
    pub bump: u8,
}

#[account]
pub struct RoundState {
    pub round_id: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub total_participants: u32,
    pub total_token_entries: u32,
    pub status: RoundStatus,
    pub vrf_result: Option<[u8; 32]>,
    pub winner_token: Option<Pubkey>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum RoundStatus {
    Active,
    VrfRequested,
    Complete,
}

#[account]
pub struct Participation {
    pub user: Pubkey,
    pub round_id: u64,
    pub tokens: Vec<TokenEntry>,
    pub timestamp: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TokenEntry {
    pub token_mint: Pubkey,
    pub ticker: String,
    pub loss_amount_usd: u64,    // In cents (e.g., 44076 = $440.76)
    pub holdings: u64,
}

#[account]
pub struct TokenPool {
    pub round_id: u64,
    pub entries: Vec<TokenPoolEntry>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TokenPoolEntry {
    pub token_mint: Pubkey,
    pub ticker: String,
    pub submission_count: u32,
    pub color: String,
}

// ============ Context Structures ============

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 8 + 1 + 1 + 8 + 8 + 1,
        seeds = [b"protocol"],
        bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartRound<'info> {
    #[account(
        mut,
        seeds = [b"protocol"],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        init,
        payer = payer,
        space = 8 + 8 + 8 + 8 + 4 + 4 + 1 + 33 + 33 + 1,
        seeds = [b"round", &(protocol_state.current_round + 1).to_le_bytes()],
        bump
    )]
    pub round_state: Account<'info, RoundState>,

    /// Previous round (optional, for validation)
    pub previous_round: Option<Account<'info, RoundState>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Participate<'info> {
    #[account(
        seeds = [b"protocol"],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [b"round", &round_state.round_id.to_le_bytes()],
        bump = round_state.bump
    )]
    pub round_state: Account<'info, RoundState>,

    #[account(
        init,
        payer = user,
        space = 8 + 32 + 8 + 4 + (32 + 32 + 8 + 8) * 3 + 8 + 1, // Max 3 tokens
        seeds = [b"participation", round_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub participation: Account<'info, Participation>,

    #[account(mut)]
    pub token_pool_entries: Account<'info, TokenPool>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(
        mut,
        seeds = [b"protocol"],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [b"round", &round_state.round_id.to_le_bytes()],
        bump = round_state.bump
    )]
    pub round_state: Account<'info, RoundState>,

    // Switchboard VRF accounts
    #[account(mut)]
    pub vrf: AccountLoader<'info, VrfAccountData>,

    #[account(mut)]
    pub oracle_queue: AccountLoader<'info, OracleQueueAccountData>,

    /// CHECK: Queue authority
    pub queue_authority: AccountInfo<'info>,

    /// CHECK: Data buffer for VRF
    #[account(mut)]
    pub data_buffer: AccountInfo<'info>,

    pub permission: AccountLoader<'info, PermissionAccountData>,

    #[account(mut)]
    pub escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer_wallet: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Recent blockhashes sysvar
    pub recent_blockhashes: AccountInfo<'info>,

    pub switchboard_program_state: AccountLoader<'info, SbState>,

    /// CHECK: Switchboard program
    pub switchboard_program: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    #[account(
        mut,
        seeds = [b"protocol"],
        bump = protocol_state.bump
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [b"round", &round_state.round_id.to_le_bytes()],
        bump = round_state.bump
    )]
    pub round_state: Account<'info, RoundState>,

    pub vrf: AccountLoader<'info, VrfAccountData>,

    #[account(mut)]
    pub token_pool: Account<'info, TokenPool>,
}

// ============ Events ============

#[event]
pub struct RoundStarted {
    pub round_id: u64,
    pub start_time: i64,
    pub end_time: i64,
}

#[event]
pub struct UserParticipated {
    pub round_id: u64,
    pub user: Pubkey,
    pub token_count: u8,
}

#[event]
pub struct VrfRequested {
    pub round_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct RoundComplete {
    pub round_id: u64,
    pub winner_token: Pubkey,
    pub vrf_result: [u8; 32],
}

// ============ Errors ============

#[error_code]
pub enum RecoveryRoomError {
    #[msg("Round is not active")]
    RoundNotActive,

    #[msg("Round has already ended")]
    RoundEnded,

    #[msg("Round has not ended yet")]
    RoundNotEnded,

    #[msg("Invalid token count (must be 1-3)")]
    InvalidTokenCount,

    #[msg("Previous round not complete")]
    PreviousRoundNotComplete,

    #[msg("Invalid round status")]
    InvalidRoundStatus,

    #[msg("No participants in round")]
    NoParticipants,

    #[msg("VRF result not yet resolved")]
    VrfNotResolved,

    #[msg("User already participated in this round")]
    AlreadyParticipated,

    #[msg("Token does not meet minimum loss requirement")]
    InsufficientLoss,
}
