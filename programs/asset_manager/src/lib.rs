use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use solana_program::pubkey::Pubkey;

declare_id!("BTUNGZRPneBjkP7yEybK3dN4gjGrBvjgRqKgouJwfxwf");

const DAYS_IN_YEAR: u64 = 365;
const APY_PRECISION: u64 = 10000;
const MIN_LOCK_PERIOD: u64 = 1;
const MAX_LOCK_PERIOD: u64 = 365;
const MIN_PRODUCT_PRICE: u64 = 10;
const MAX_PRODUCT_PRICE: u64 = 10000;

#[program]
pub mod asset_manager {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, jupsol_mint: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.is_initialized = true;
        state.is_paused = false;
        state.jupsol_mint = jupsol_mint;
        state.authority = ctx.accounts.authority.key();
        state.current_apy = 762; // Initialize APY to 7.62%
        state.last_apy_update = Clock::get()?.unix_timestamp;
        state.product_price = 1798; // Initialize product price to 1798
        Ok(())
    }

    pub fn pause_system(ctx: Context<PauseSystem>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.state.authority,
            AssetManagerError::UnauthorizedAccount
        );
        ctx.accounts.state.is_paused = true;
        Ok(())
    }

    pub fn unpause_system(ctx: Context<PauseSystem>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.state.authority,
            AssetManagerError::UnauthorizedAccount
        );
        ctx.accounts.state.is_paused = false;
        Ok(())
    }

    pub fn deposit_asset(ctx: Context<DepositAsset>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.state.is_paused, AssetManagerError::SystemPaused);
        require!(ctx.accounts.asset_mint.key() == ctx.accounts.state.jupsol_mint, AssetManagerError::InvalidAssetType);
        require!(amount > 0, AssetManagerError::InvalidAmount);

        let asset_price = get_asset_price(&ctx.accounts.oracle, &ctx.accounts.asset_mint.key())?;

        let deposit_value = (amount as u128)
            .checked_mul(asset_price as u128)
            .ok_or(AssetManagerError::CalculationError)?
            .checked_div(10u128.pow(ctx.accounts.asset_mint.decimals as u32) as u128)
            .ok_or(AssetManagerError::CalculationError)?;

        require!(ctx.accounts.user_asset_account.amount >= amount, AssetManagerError::InsufficientBalance);

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_asset_account.to_account_info(),
            to: ctx.accounts.vault_asset_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        ctx.accounts.user_deposit.amount = ctx.accounts.user_deposit.amount
            .checked_add(deposit_value as u64)
            .ok_or(AssetManagerError::CalculationError)?;

        emit!(DepositEvent {
            user: ctx.accounts.user.key(),
            amount,
            value: deposit_value as u64,
        });

        msg!("Deposit successful: {} tokens deposited, value: {}", amount, deposit_value);

        Ok(())
    }

    pub fn mint_and_distribute_xxusd(ctx: Context<MintAndDistributeXxUSD>, asset_value: u64, product_price: u64) -> Result<()> {
        require!(!ctx.accounts.state.is_paused, AssetManagerError::SystemPaused);

        let total_xxusd_amount = asset_value;
        let locked_xxusd_amount = product_price;
        let user_xxusd_amount = total_xxusd_amount
            .checked_sub(locked_xxusd_amount)
            .ok_or(AssetManagerError::CalculationError)?;

        require!(
            total_xxusd_amount <= ctx.accounts.state.minting_limit,
            AssetManagerError::MintingLimitExceeded
        );

        let seeds = &[
            ctx.accounts.state.to_account_info().key.as_ref(),
            &[ctx.accounts.state.nonce],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = token::MintTo {
            mint: ctx.accounts.xxusd_mint.to_account_info(),
            to: ctx.accounts.xxusd_vault.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::mint_to(cpi_ctx, total_xxusd_amount)?;

        let transfer_accounts = token::Transfer {
            from: ctx.accounts.xxusd_vault.to_account_info(),
            to: ctx.accounts.user_xxusd_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_accounts,
            signer
        );
        token::transfer(transfer_ctx, user_xxusd_amount)?;

        ctx.accounts.user_deposit.xxusd_amount = ctx.accounts.user_deposit.xxusd_amount
            .checked_add(user_xxusd_amount)
            .ok_or(AssetManagerError::CalculationError)?;

        emit!(MintAndDistributeEvent {
            user: ctx.accounts.user.key(),
            total_amount: total_xxusd_amount,
            locked_amount: locked_xxusd_amount,
            user_amount: user_xxusd_amount,
        });

        msg!("xxUSD minted and distributed: total {}, locked {}, user {}", total_xxusd_amount, locked_xxusd_amount, user_xxusd_amount);

        Ok(())
    }

    pub fn calculate_lock_period(ctx: Context<CalculateLockPeriod>, product_price: u64, asset_value: u64) -> Result<u64> {
        let apy = ctx.accounts.state.current_apy;
        require!(apy > 0, AssetManagerError::InvalidAPY);

        msg!("Calculating lock period with product_price: {}, asset_value: {}, apy: {}", product_price, asset_value, apy);

        let lock_period = (product_price as u128)
            .checked_mul(DAYS_IN_YEAR as u128)
            .and_then(|result| result.checked_mul(APY_PRECISION as u128))
            .and_then(|result| {
                let denominator = (asset_value as u128).checked_mul(apy as u128)
                    .ok_or(AssetManagerError::CalculationError).ok()?;
                result.checked_div(denominator)
            })
            .ok_or(AssetManagerError::CalculationError)?;

        let lock_period = lock_period.clamp(MIN_LOCK_PERIOD as u128, MAX_LOCK_PERIOD as u128) as u64;

        emit!(LockPeriodCalculatedEvent {
            product_price,
            asset_value,
            apy,
            lock_period,
        });

        msg!("Lock period calculated: {} days", lock_period);

        Ok(lock_period)
    }

    pub fn update_apy(ctx: Context<UpdateAPY>, new_apy: u64) -> Result<()> {
        require!(new_apy > 0, AssetManagerError::InvalidAPY);
        
        let state = &mut ctx.accounts.state;
        let old_apy = state.current_apy;
        state.current_apy = new_apy;
        state.last_apy_update = Clock::get()?.unix_timestamp;

        emit!(APYUpdatedEvent {
            old_apy,
            new_apy,
            timestamp: state.last_apy_update,
        });

        msg!("APY updated from {} to {}", old_apy, new_apy);

        Ok(())
    }

    pub fn set_product_price(ctx: Context<SetProductPrice>, new_price: u64) -> Result<()> {
        // 驗證價格的合理性
        require!(
            new_price >= MIN_PRODUCT_PRICE && new_price <= MAX_PRODUCT_PRICE,
            AssetManagerError::InvalidPrice
        );

        let old_price = ctx.accounts.state.product_price;
        
        // 更新商品價格
        ctx.accounts.state.product_price = new_price;

        // 記錄價格變更
        emit!(PriceChangedEvent {
            old_price,
            new_price,
            authority: ctx.accounts.authority.key(),
        });

        msg!("Product price updated from {} to {}", old_price, new_price);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 8 + 32 + 32 + 8 + 1 + 8 + 8 + 8)]
    pub state: Account<'info, ProgramState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PauseSystem<'info> {
    #[account(mut)]
    pub state: Account<'info, ProgramState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct DepositAsset<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_asset_account.owner == user.key() @ AssetManagerError::UnauthorizedAccount,
        constraint = user_asset_account.mint == asset_mint.key() @ AssetManagerError::InvalidAssetAccount
    )]
    pub user_asset_account: Account<'info, TokenAccount>,
    pub asset_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", asset_mint.key().as_ref()],
        bump
    )]
    pub vault_asset_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 8 + 8,
        seeds = [b"user_deposit", user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    #[account(constraint = state.is_initialized @ AssetManagerError::UninitializedState)]
    pub state: Account<'info, ProgramState>,
    /// CHECK: This account is not read or written in this instruction
    pub oracle: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintAndDistributeXxUSD<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub xxusd_mint: Account<'info, Mint>,
    #[account(mut)]
    pub xxusd_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_xxusd_account: Account<'info, TokenAccount>,
    /// CHECK: This account is used as the mint authority
    #[account(seeds = [state.to_account_info().key.as_ref()], bump = state.nonce)]
    pub mint_authority: AccountInfo<'info>,
    /// CHECK: This account is used as the vault authority
    #[account(seeds = [state.to_account_info().key.as_ref()], bump = state.nonce)]
    pub vault_authority: AccountInfo<'info>,
    #[account(mut)]
    pub user_deposit: Account<'info, UserDeposit>,
    #[account(constraint = state.is_initialized @ AssetManagerError::UninitializedState)]
    pub state: Account<'info, ProgramState>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CalculateLockPeriod<'info> {
    #[account(constraint = state.is_initialized @ AssetManagerError::UninitializedState)]
    pub state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
pub struct UpdateAPY<'info> {
    #[account(mut, constraint = state.is_initialized @ AssetManagerError::UninitializedState)]
    pub state: Account<'info, ProgramState>,
    #[account(constraint = authority.key() == state.authority @ AssetManagerError::UnauthorizedAccount)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetProductPrice<'info> {
    #[account(mut, constraint = state.is_initialized @ AssetManagerError::UninitializedState)]
    pub state: Account<'info, ProgramState>,
    #[account(constraint = authority.key() == state.authority @ AssetManagerError::UnauthorizedAccount)]
    pub authority: Signer<'info>,
}

#[account]
pub struct UserDeposit {
    pub amount: u64,
    pub xxusd_amount: u64,
}

#[account]
pub struct ProgramState {
    pub is_initialized: bool,
    pub is_paused: bool,
    pub jupsol_mint: Pubkey,
    pub authority: Pubkey,
    pub minting_limit: u64,
    pub nonce: u8,
    pub current_apy: u64,
    pub last_apy_update: i64,
    pub product_price: u64,
}

#[error_code]
pub enum AssetManagerError {
    #[msg("System is paused")]
    SystemPaused,
    #[msg("Invalid asset type")]
    InvalidAssetType,
    #[msg("Calculation error")]
    CalculationError,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Unauthorized account")]
    UnauthorizedAccount,
    #[msg("Invalid asset account")]
    InvalidAssetAccount,
    #[msg("Uninitialized state")]
    UninitializedState,
    #[msg("Oracle error")]
    OracleError,
    #[msg("Minting limit exceeded")]
    MintingLimitExceeded,
    #[msg("Invalid APY")]
    InvalidAPY,
    #[msg("Invalid price")]
    InvalidPrice,
}

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub value: u64,
}

#[event]
pub struct MintAndDistributeEvent {
    pub user: Pubkey,
    pub total_amount: u64,
    pub locked_amount: u64,
    pub user_amount: u64,
}

#[event]
pub struct LockPeriodCalculatedEvent {
    pub product_price: u64,
    pub asset_value: u64,
    pub apy: u64,
    pub lock_period: u64,
}

#[event]
pub struct APYUpdatedEvent {
    pub old_apy: u64,
    pub new_apy: u64,
    pub timestamp: i64,
}

#[event]
pub struct PriceChangedEvent {
    pub old_price: u64,
    pub new_price: u64,
    pub authority: Pubkey,
}

fn get_asset_price(oracle: &AccountInfo, asset_mint: &Pubkey) -> Result<u64> {
    // TODO: Implement actual Oracle price fetching logic
    msg!("Fetching price from Oracle for asset: {}", asset_mint);
    Ok(1_000_000) // 假設價格，實際應從 Oracle 獲取
}