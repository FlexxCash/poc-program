use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use switchboard_on_demand::on_demand::accounts::pull_feed::PullFeedAccountData;
use switchboard_on_demand::prelude::rust_decimal::prelude::ToPrimitive;
use std::str::FromStr;

declare_id!("9WgQXggiUsfN1w4rXGsxE4Zvv8BtTuqZ2NpFUUKLYwVf");

#[program]
pub mod price_oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let oracle_account = &mut ctx.accounts.oracle_account;
        oracle_account.authority = *ctx.accounts.authority.key;

        // 初始化 SOL 價格數據源
        oracle_account.sol_feed = Pubkey::from_str("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.last_update_timestamp_sol = 0;
        oracle_account.cached_price_sol = 0;

        // 初始化 InterestAsset 的數據源
        oracle_account.interest_asset_feed = Pubkey::from_str("4NiWaTuje7SVe9DN1vfnX7m1qBC7DnUxwRxbdgEDUGX1")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.last_update_timestamp_interest_asset = 0;

        msg!("Oracle initialized with SOL feed account and Interest Asset feed account.");

        Ok(())
    }

    pub fn get_price(ctx: Context<GetPrice>, asset: String) -> Result<()> {
        let oracle_account = &mut ctx.accounts.oracle_account;

        // 獲取當前時鐘
        let clock = Clock::get()?;

        // 檢查是否初始化
        require!(
            oracle_account.authority != Pubkey::default(),
            PriceOracleError::NotInitialized
        );

        match asset.as_str() {
            "SOL" => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_sol <= 60 {
                    msg!("Returning cached SOL price: {}", oracle_account.cached_price_sol);
                    return Ok(());
                }

                let feed_account = ctx.accounts.sol_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let price = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let price_u64 = price.to_u64().ok_or(PriceOracleError::PriceConversionFailed)?;

                require!(price_u64 > 0, PriceOracleError::ZeroPrice);

                oracle_account.cached_price_sol = price_u64;
                oracle_account.last_update_timestamp_sol = clock.unix_timestamp;

                msg!("New SOL price fetched and cached: {}", price_u64);
            }
            "InterestAsset" => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_interest_asset <= 60 {
                    msg!("Returning cached Interest Asset data");
                    return Ok(());
                }

                let feed_account = ctx.accounts.interest_asset_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let result = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let result_str = result.to_string();
                let result_parts: Vec<&str> = result_str.split(',').collect();

                if result_parts.len() != 13 {
                    return Err(PriceOracleError::InvalidDataFormat.into());
                }

                oracle_account.jupsol_price = result_parts[0].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.jupsol_apy = result_parts[1].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.vsol_price = result_parts[2].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.vsol_apy = result_parts[3].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.bsol_price = result_parts[4].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.bsol_apy = result_parts[5].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.msol_price = result_parts[6].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.msol_apy = result_parts[7].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.hsol_price = result_parts[8].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.hsol_apy = result_parts[9].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.jitosol_price = result_parts[10].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;
                oracle_account.jitosol_apy = result_parts[11].parse().map_err(|_| PriceOracleError::PriceConversionFailed)?;

                oracle_account.last_update_timestamp_interest_asset = clock.unix_timestamp;

                msg!("New Interest Asset data fetched and cached");
            }
            _ => {
                return Err(PriceOracleError::InvalidAsset.into());
            }
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 12 * 8)]
    pub oracle_account: Account<'info, OracleAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: This is the Switchboard SOL feed account, which is validated in the instruction logic
    pub sol_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard Interest Asset feed account
    pub interest_asset_feed: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetPrice<'info> {
    #[account(mut)]
    pub oracle_account: Account<'info, OracleAccount>,
    /// CHECK: This is the Switchboard SOL feed account, which is validated in the instruction logic
    pub sol_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard Interest Asset feed account
    pub interest_asset_feed: AccountInfo<'info>,
}

#[account]
pub struct OracleAccount {
    pub authority: Pubkey,
    pub sol_feed: Pubkey,
    pub interest_asset_feed: Pubkey,
    pub last_update_timestamp_sol: i64,
    pub cached_price_sol: u64,
    pub last_update_timestamp_interest_asset: i64,
    pub jupsol_price: f64,
    pub jupsol_apy: f64,
    pub vsol_price: f64,
    pub vsol_apy: f64,
    pub bsol_price: f64,
    pub bsol_apy: f64,
    pub msol_price: f64,
    pub msol_apy: f64,
    pub hsol_price: f64,
    pub hsol_apy: f64,
    pub jitosol_price: f64,
    pub jitosol_apy: f64,
}

#[error_code]
pub enum PriceOracleError {
    #[msg("Not Initialized")]
    NotInitialized,
    #[msg("Price Fetch Failed")]
    PriceFetchFailed,
    #[msg("Price Conversion Failed")]
    PriceConversionFailed,
    #[msg("Invalid Asset")]
    InvalidAsset,
    #[msg("Zero Price")]
    ZeroPrice,
    #[msg("Invalid Feed Key")]
    InvalidFeedKey,
    #[msg("Invalid Data Format")]
    InvalidDataFormat,
}