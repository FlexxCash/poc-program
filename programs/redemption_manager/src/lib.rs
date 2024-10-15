use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Burn};
use solana_program::native_token::LAMPORTS_PER_SOL;

declare_id!("4cpZCegz9towsw4UU8E4YmZx4N7D9pC5ocpAYuMEtFLt");

#[program]
pub mod redemption_manager {
    use super::*;

    pub fn initialize_system_state(ctx: Context<InitializeSystemState>) -> Result<()> {
        ctx.accounts.system_state.is_paused = false;
        Ok(())
    }

    pub fn pause_system(ctx: Context<PauseSystem>) -> Result<()> {
        ctx.accounts.system_state.is_paused = true;
        Ok(())
    }

    pub fn unpause_system(ctx: Context<PauseSystem>) -> Result<()> {
        ctx.accounts.system_state.is_paused = false;
        Ok(())
    }

    pub fn initiate_redeem(ctx: Context<InitiateRedeem>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.system_state.is_paused, RedemptionError::SystemPaused);

        let current_time = Clock::get()?.unix_timestamp;
        let lock_end_time = ctx.accounts.lock_record.start_time + (ctx.accounts.lock_record.lock_period as i64 * 86400);
        require!(current_time >= lock_end_time, RedemptionError::LockPeriodNotEnded);

        let redemption_end_time = lock_end_time + (14 * 86400);
        require!(current_time <= redemption_end_time, RedemptionError::RedemptionPeriodEnded);

        require!(ctx.accounts.user_token_account.amount >= amount, RedemptionError::InsufficientBalance);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.redemption_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let redemption_request = &mut ctx.accounts.redemption_request;
        redemption_request.user = ctx.accounts.user.key();
        redemption_request.amount = amount;
        redemption_request.request_time = current_time;
        redemption_request.is_processed = false;

        emit!(RedemptionInitiatedEvent {
            user: ctx.accounts.user.key(),
            amount,
            request_time: current_time,
        });

        Ok(())
    }

    pub fn execute_redeem(ctx: Context<ExecuteRedeem>) -> Result<()> {
        require!(!ctx.accounts.system_state.is_paused, RedemptionError::SystemPaused);

        let redemption_request = &mut ctx.accounts.redemption_request;
        require!(!redemption_request.is_processed, RedemptionError::AlreadyProcessed);

        let sol_amount = redemption_request.amount / LAMPORTS_PER_SOL;

        let cpi_accounts = Burn {
            mint: ctx.accounts.xxusd_mint.to_account_info(),
            from: ctx.accounts.redemption_vault.to_account_info(),
            authority: ctx.accounts.redemption_manager.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let seeds = &[
            b"redemption_manager".as_ref(),
            &[ctx.bumps.redemption_manager],
        ];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::burn(cpi_ctx, redemption_request.amount)?;

        **ctx.accounts.redemption_manager.to_account_info().try_borrow_mut_lamports()? -= sol_amount;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += sol_amount;

        redemption_request.is_processed = true;

        emit!(RedemptionExecutedEvent {
            user: ctx.accounts.user.key(),
            amount: redemption_request.amount,
            sol_amount,
        });

        Ok(())
    }

    pub fn check_redeem_eligibility(ctx: Context<CheckRedeemEligibility>) -> Result<bool> {
        let lock_record = &ctx.accounts.lock_record;
        let current_time = Clock::get()?.unix_timestamp;
        let lock_end_time = lock_record.start_time + (lock_record.lock_period as i64 * 86400);
        
        if current_time < lock_end_time {
            return Ok(false);
        }

        let redemption_end_time = lock_end_time + (14 * 86400);
        if current_time > redemption_end_time {
            return Ok(false);
        }

        let user_balance = ctx.accounts.user_token_account.amount;
        if user_balance == 0 {
            return Ok(false);
        }

        Ok(true)
    }
}

#[derive(Accounts)]
pub struct InitializeSystemState<'info> {
    #[account(init, payer = authority, space = 8 + 1)]
    pub system_state: Account<'info, SystemState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PauseSystem<'info> {
    #[account(mut)]
    pub system_state: Account<'info, SystemState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitiateRedeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ RedemptionError::InvalidOwner
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub redemption_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"lock_record", user.key().as_ref()],
        bump,
        constraint = lock_record.owner == user.key() @ RedemptionError::InvalidOwner,
    )]
    pub lock_record: Account<'info, LockRecord>,
    #[account(
        init,
        payer = user,
        space = 8 + 32 + 8 + 8 + 1,
        seeds = [b"redemption_request", user.key().as_ref()],
        bump
    )]
    pub redemption_request: Account<'info, RedemptionRequest>,
    pub system_state: Account<'info, SystemState>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteRedeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub redemption_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"redemption_request", user.key().as_ref()],
        bump,
        constraint = redemption_request.user == user.key() @ RedemptionError::InvalidOwner,
    )]
    pub redemption_request: Account<'info, RedemptionRequest>,
    pub system_state: Account<'info, SystemState>,
    #[account(mut)]
    pub xxusd_mint: Account<'info, token::Mint>,
    /// CHECK: This is the PDA for the redemption manager
    #[account(
        mut,
        seeds = [b"redemption_manager"],
        bump
    )]
    pub redemption_manager: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CheckRedeemEligibility<'info> {
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"lock_record", user.key().as_ref()],
        bump,
        constraint = lock_record.owner == user.key() @ RedemptionError::InvalidOwner,
    )]
    pub lock_record: Account<'info, LockRecord>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ RedemptionError::InvalidOwner
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    pub system_state: Account<'info, SystemState>,
}

#[account]
pub struct RedemptionRequest {
    pub user: Pubkey,
    pub amount: u64,
    pub request_time: i64,
    pub is_processed: bool,
}

#[account]
pub struct SystemState {
    pub is_paused: bool,
}

#[account]
pub struct LockRecord {
    pub owner: Pubkey,
    pub amount: u64,
    pub lock_period: u64,
    pub start_time: i64,
}

#[error_code]
pub enum RedemptionError {
    #[msg("System is paused")]
    SystemPaused,
    #[msg("Lock period has not ended")]
    LockPeriodNotEnded,
    #[msg("Redemption period has ended")]
    RedemptionPeriodEnded,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Invalid owner")]
    InvalidOwner,
    #[msg("Redemption request already processed")]
    AlreadyProcessed,
    #[msg("User is not eligible for redemption")]
    NotEligibleForRedemption,
}

#[event]
pub struct RedemptionInitiatedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub request_time: i64,
}

#[event]
pub struct RedemptionExecutedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub sol_amount: u64,
}