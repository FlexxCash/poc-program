use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use switchboard_on_demand::on_demand::accounts::pull_feed::PullFeedAccountData;
use switchboard_on_demand::prelude::rust_decimal::prelude::ToPrimitive;
use std::str::FromStr;

declare_id!("CzpZdoxJhQjtzG7oLgTHinsPjtMFVzRXEYWy1pn3wQ9Z");

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

        // 初始化 InterestAsset 的各個價格和 APY 數據源
        oracle_account.jupsol_price_feed = Pubkey::from_str("FeedPubkeyForJupSOLPrice")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.jupsol_apy_feed = Pubkey::from_str("FeedPubkeyForJupSOLAPY")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.last_update_timestamp_jupsol = 0;
        oracle_account.cached_price_jupsol = 0;
        oracle_account.cached_apy_jupsol = 0.0;

        oracle_account.vsol_price_feed = Pubkey::from_str("FeedPubkeyForvSOLPrice")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.vsol_apy_feed = Pubkey::from_str("FeedPubkeyForvSOLAPY")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.last_update_timestamp_vsol = 0;
        oracle_account.cached_price_vsol = 0;
        oracle_account.cached_apy_vsol = 0.0;

        oracle_account.bsol_price_feed = Pubkey::from_str("FeedPubkeyForbSOLPrice")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.bsol_apy_feed = Pubkey::from_str("FeedPubkeyForbSOLAPY")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.last_update_timestamp_bsol = 0;
        oracle_account.cached_price_bsol = 0;
        oracle_account.cached_apy_bsol = 0.0;

        oracle_account.msol_price_feed = Pubkey::from_str("FeedPubkeyFormSOLPrice")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.msol_apy_feed = Pubkey::from_str("FeedPubkeyFormSOLAPY")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.last_update_timestamp_msol = 0;
        oracle_account.cached_price_msol = 0;
        oracle_account.cached_apy_msol = 0.0;

        oracle_account.hsol_price_feed = Pubkey::from_str("FeedPubkeyForHSOLPrice")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.hsol_apy_feed = Pubkey::from_str("FeedPubkeyForHSOLAPY")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.last_update_timestamp_hsol = 0;
        oracle_account.cached_price_hsol = 0;
        oracle_account.cached_apy_hsol = 0.0;

        oracle_account.jitosol_price_feed = Pubkey::from_str("FeedPubkeyForJitoSOLPrice")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.jitosol_apy_feed = Pubkey::from_str("FeedPubkeyForJitoSOLAPY")
            .map_err(|_| PriceOracleError::InvalidFeedKey)?;
        oracle_account.last_update_timestamp_jitosol = 0;
        oracle_account.cached_price_jitosol = 0;
        oracle_account.cached_apy_jitosol = 0.0;

        msg!(
            "Oracle initialized with SOL feed account and various Interest Asset feed accounts."
        );

        Ok(())
    }

    pub fn get_price(ctx: Context<GetPrice>, asset: String, data_type: String) -> Result<(u64, Option<f64>)> {
        let oracle_account = &mut ctx.accounts.oracle_account;

        // 獲取當前時鐘
        let clock = Clock::get()?;

        // 檢查是否初始化
        require!(
            oracle_account.authority != Pubkey::default(),
            PriceOracleError::NotInitialized
        );

        // 根據資產名稱和數據類型選擇相應的數據源
        match (asset.as_str(), data_type.as_str()) {
            ("SOL", "price") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_sol <= 60 {
                    msg!("Returning cached SOL price: {}", oracle_account.cached_price_sol);
                    return Ok((oracle_account.cached_price_sol, None));
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

                Ok((price_u64, None))
            }
            ("JupSOL", "price") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_jupsol <= 60 {
                    msg!(
                        "Returning cached JupSOL price: {}",
                        oracle_account.cached_price_jupsol
                    );
                    return Ok((oracle_account.cached_price_jupsol, Some(oracle_account.cached_apy_jupsol)));
                }

                let feed_account = ctx.accounts.jupsol_price_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let price = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let price_u64 = price.to_u64().ok_or(PriceOracleError::PriceConversionFailed)?;

                require!(price_u64 > 0, PriceOracleError::ZeroPrice);

                oracle_account.cached_price_jupsol = price_u64;
                oracle_account.last_update_timestamp_jupsol = clock.unix_timestamp;

                msg!("New JupSOL price fetched and cached: {}", price_u64);

                Ok((price_u64, None))
            }
            ("JupSOL", "apy") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_jupsol <= 60 {
                    msg!(
                        "Returning cached JupSOL APY: {}",
                        oracle_account.cached_apy_jupsol
                    );
                    return Ok((oracle_account.cached_price_jupsol, Some(oracle_account.cached_apy_jupsol)));
                }

                let feed_account = ctx.accounts.jupsol_apy_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let apy_decimal = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let apy_f64 = apy_decimal.to_f64().ok_or(PriceOracleError::PriceConversionFailed)?;

                oracle_account.cached_apy_jupsol = apy_f64;
                oracle_account.last_update_timestamp_jupsol = clock.unix_timestamp;

                msg!("New JupSOL APY fetched and cached: {}", apy_f64);

                Ok((oracle_account.cached_price_jupsol, Some(apy_f64)))
            }
            // 同樣地，為其他資產（vSOL, bSOL, mSOL, HSOL, JitoSOL）添加價格和 APY 的處理
            ("vSOL", "price") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_vsol <= 60 {
                    msg!(
                        "Returning cached vSOL price: {}",
                        oracle_account.cached_price_vsol
                    );
                    return Ok((oracle_account.cached_price_vsol, Some(oracle_account.cached_apy_vsol)));
                }

                let feed_account = ctx.accounts.vsol_price_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let price = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let price_u64 = price.to_u64().ok_or(PriceOracleError::PriceConversionFailed)?;

                require!(price_u64 > 0, PriceOracleError::ZeroPrice);

                oracle_account.cached_price_vsol = price_u64;
                oracle_account.last_update_timestamp_vsol = clock.unix_timestamp;

                msg!("New vSOL price fetched and cached: {}", price_u64);

                Ok((price_u64, None))
            }
            ("vSOL", "apy") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_vsol <= 60 {
                    msg!(
                        "Returning cached vSOL APY: {}",
                        oracle_account.cached_apy_vsol
                    );
                    return Ok((oracle_account.cached_price_vsol, Some(oracle_account.cached_apy_vsol)));
                }

                let feed_account = ctx.accounts.vsol_apy_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let apy_decimal = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let apy_f64 = apy_decimal.to_f64().ok_or(PriceOracleError::PriceConversionFailed)?;

                oracle_account.cached_apy_vsol = apy_f64;
                oracle_account.last_update_timestamp_vsol = clock.unix_timestamp;

                msg!("New vSOL APY fetched and cached: {}", apy_f64);

                Ok((oracle_account.cached_price_vsol, Some(apy_f64)))
            }
            // 重複上述模式，為 bSOL, mSOL, HSOL, JitoSOL 分別處理價格和 APY
            ("bSOL", "price") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_bsol <= 60 {
                    msg!(
                        "Returning cached bSOL price: {}",
                        oracle_account.cached_price_bsol
                    );
                    return Ok((oracle_account.cached_price_bsol, Some(oracle_account.cached_apy_bsol)));
                }

                let feed_account = ctx.accounts.bsol_price_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let price = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let price_u64 = price.to_u64().ok_or(PriceOracleError::PriceConversionFailed)?;

                require!(price_u64 > 0, PriceOracleError::ZeroPrice);

                oracle_account.cached_price_bsol = price_u64;
                oracle_account.last_update_timestamp_bsol = clock.unix_timestamp;

                msg!("New bSOL price fetched and cached: {}", price_u64);

                Ok((price_u64, None))
            }
            ("bSOL", "apy") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_bsol <= 60 {
                    msg!(
                        "Returning cached bSOL APY: {}",
                        oracle_account.cached_apy_bsol
                    );
                    return Ok((oracle_account.cached_price_bsol, Some(oracle_account.cached_apy_bsol)));
                }

                let feed_account = ctx.accounts.bsol_apy_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let apy_decimal = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let apy_f64 = apy_decimal.to_f64().ok_or(PriceOracleError::PriceConversionFailed)?;

                oracle_account.cached_apy_bsol = apy_f64;
                oracle_account.last_update_timestamp_bsol = clock.unix_timestamp;

                msg!("New bSOL APY fetched and cached: {}", apy_f64);

                Ok((oracle_account.cached_price_bsol, Some(apy_f64)))
            }
            ("mSOL", "price") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_msol <= 60 {
                    msg!(
                        "Returning cached mSOL price: {}",
                        oracle_account.cached_price_msol
                    );
                    return Ok((oracle_account.cached_price_msol, Some(oracle_account.cached_apy_msol)));
                }

                let feed_account = ctx.accounts.msol_price_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let price = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let price_u64 = price.to_u64().ok_or(PriceOracleError::PriceConversionFailed)?;

                require!(price_u64 > 0, PriceOracleError::ZeroPrice);

                oracle_account.cached_price_msol = price_u64;
                oracle_account.last_update_timestamp_msol = clock.unix_timestamp;

                msg!("New mSOL price fetched and cached: {}", price_u64);

                Ok((price_u64, None))
            }
            ("mSOL", "apy") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_msol <= 60 {
                    msg!(
                        "Returning cached mSOL APY: {}",
                        oracle_account.cached_apy_msol
                    );
                    return Ok((oracle_account.cached_price_msol, Some(oracle_account.cached_apy_msol)));
                }

                let feed_account = ctx.accounts.msol_apy_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let apy_decimal = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let apy_f64 = apy_decimal.to_f64().ok_or(PriceOracleError::PriceConversionFailed)?;

                oracle_account.cached_apy_msol = apy_f64;
                oracle_account.last_update_timestamp_msol = clock.unix_timestamp;

                msg!("New mSOL APY fetched and cached: {}", apy_f64);

                Ok((oracle_account.cached_price_msol, Some(apy_f64)))
            }
            ("HSOL", "price") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_hsol <= 60 {
                    msg!(
                        "Returning cached HSOL price: {}",
                        oracle_account.cached_price_hsol
                    );
                    return Ok((oracle_account.cached_price_hsol, Some(oracle_account.cached_apy_hsol)));
                }

                let feed_account = ctx.accounts.hsol_price_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let price = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let price_u64 = price.to_u64().ok_or(PriceOracleError::PriceConversionFailed)?;

                require!(price_u64 > 0, PriceOracleError::ZeroPrice);

                oracle_account.cached_price_hsol = price_u64;
                oracle_account.last_update_timestamp_hsol = clock.unix_timestamp;

                msg!("New HSOL price fetched and cached: {}", price_u64);

                Ok((price_u64, None))
            }
            ("HSOL", "apy") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_hsol <= 60 {
                    msg!(
                        "Returning cached HSOL APY: {}",
                        oracle_account.cached_apy_hsol
                    );
                    return Ok((oracle_account.cached_price_hsol, Some(oracle_account.cached_apy_hsol)));
                }

                let feed_account = ctx.accounts.hsol_apy_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let apy_decimal = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let apy_f64 = apy_decimal.to_f64().ok_or(PriceOracleError::PriceConversionFailed)?;

                oracle_account.cached_apy_hsol = apy_f64;
                oracle_account.last_update_timestamp_hsol = clock.unix_timestamp;

                msg!("New HSOL APY fetched and cached: {}", apy_f64);

                Ok((oracle_account.cached_price_hsol, Some(apy_f64)))
            }
            ("JitoSOL", "price") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_jitosol <= 60 {
                    msg!(
                        "Returning cached JitoSOL price: {}",
                        oracle_account.cached_price_jitosol
                    );
                    return Ok((oracle_account.cached_price_jitosol, Some(oracle_account.cached_apy_jitosol)));
                }

                let feed_account = ctx.accounts.jitosol_price_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let price = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let price_u64 = price.to_u64().ok_or(PriceOracleError::PriceConversionFailed)?;

                require!(price_u64 > 0, PriceOracleError::ZeroPrice);

                oracle_account.cached_price_jitosol = price_u64;
                oracle_account.last_update_timestamp_jitosol = clock.unix_timestamp;

                msg!("New JitoSOL price fetched and cached: {}", price_u64);

                Ok((price_u64, None))
            }
            ("JitoSOL", "apy") => {
                if clock.unix_timestamp - oracle_account.last_update_timestamp_jitosol <= 60 {
                    msg!(
                        "Returning cached JitoSOL APY: {}",
                        oracle_account.cached_apy_jitosol
                    );
                    return Ok((oracle_account.cached_price_jitosol, Some(oracle_account.cached_apy_jitosol)));
                }

                let feed_account = ctx.accounts.jitosol_apy_feed.data.borrow();
                let feed = PullFeedAccountData::parse(feed_account)
                    .map_err(|_| PriceOracleError::PriceFetchFailed)?;
                let apy_decimal = feed.value().ok_or(PriceOracleError::PriceFetchFailed)?;

                let apy_f64 = apy_decimal.to_f64().ok_or(PriceOracleError::PriceConversionFailed)?;

                oracle_account.cached_apy_jitosol = apy_f64;
                oracle_account.last_update_timestamp_jitosol = clock.unix_timestamp;

                msg!("New JitoSOL APY fetched and cached: {}", apy_f64);

                Ok((oracle_account.cached_price_jitosol, Some(apy_f64)))
            }
            _ => {
                return Err(PriceOracleError::InvalidAsset.into());
            }
        }
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8)]
    pub oracle_account: Account<'info, OracleAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: This is the Switchboard SOL feed account, which is validated in the instruction logic
    pub sol_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard JupSOL price feed account
    pub jupsol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard JupSOL APY feed account
    pub jupsol_apy_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard vSOL price feed account
    pub vsol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard vSOL APY feed account
    pub vsol_apy_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard bSOL price feed account
    pub bsol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard bSOL APY feed account
    pub bsol_apy_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard mSOL price feed account
    pub msol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard mSOL APY feed account
    pub msol_apy_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard HSOL price feed account
    pub hsol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard HSOL APY feed account
    pub hsol_apy_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard JitoSOL price feed account
    pub jitosol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard JitoSOL APY feed account
    pub jitosol_apy_feed: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetPrice<'info> {
    #[account(mut)]
    pub oracle_account: Account<'info, OracleAccount>,
    /// CHECK: This is the Switchboard SOL feed account, which is validated in the instruction logic
    pub sol_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard JupSOL price feed account
    pub jupsol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard JupSOL APY feed account
    pub jupsol_apy_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard vSOL price feed account
    pub vsol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard vSOL APY feed account
    pub vsol_apy_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard bSOL price feed account
    pub bsol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard bSOL APY feed account
    pub bsol_apy_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard mSOL price feed account
    pub msol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard mSOL APY feed account
    pub msol_apy_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard HSOL price feed account
    pub hsol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard HSOL APY feed account
    pub hsol_apy_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard JitoSOL price feed account
    pub jitosol_price_feed: AccountInfo<'info>,
    /// CHECK: This is the Switchboard JitoSOL APY feed account
    pub jitosol_apy_feed: AccountInfo<'info>,
}

#[account]
pub struct OracleAccount {
    pub authority: Pubkey,
    pub sol_feed: Pubkey,
    pub jupsol_price_feed: Pubkey,
    pub jupsol_apy_feed: Pubkey,
    pub vsol_price_feed: Pubkey,
    pub vsol_apy_feed: Pubkey,
    pub bsol_price_feed: Pubkey,
    pub bsol_apy_feed: Pubkey,
    pub msol_price_feed: Pubkey,
    pub msol_apy_feed: Pubkey,
    pub hsol_price_feed: Pubkey,
    pub hsol_apy_feed: Pubkey,
    pub jitosol_price_feed: Pubkey,
    pub jitosol_apy_feed: Pubkey,
    pub last_update_timestamp_sol: i64,
    pub cached_price_sol: u64,
    pub last_update_timestamp_jupsol: i64,
    pub cached_price_jupsol: u64,
    pub cached_apy_jupsol: f64,
    pub last_update_timestamp_vsol: i64,
    pub cached_price_vsol: u64,
    pub cached_apy_vsol: f64,
    pub last_update_timestamp_bsol: i64,
    pub cached_price_bsol: u64,
    pub cached_apy_bsol: f64,
    pub last_update_timestamp_msol: i64,
    pub cached_price_msol: u64,
    pub cached_apy_msol: f64,
    pub last_update_timestamp_hsol: i64,
    pub cached_price_hsol: u64,
    pub cached_apy_hsol: f64,
    pub last_update_timestamp_jitosol: i64,
    pub cached_price_jitosol: u64,
    pub cached_apy_jitosol: f64,
}

#[error_code]
pub enum PriceOracleError {
    #[msg("Not Initialized")]
    NotInitialized,
    #[msg("Price Fetch Failed")]
    PriceFetchFailed,
    #[msg("Price Conversion Failed")]
    PriceConversionFailed,
    #[msg("Invalid Asset or Data Type")]
    InvalidAsset,
    #[msg("Zero Price")]
    ZeroPrice,
    #[msg("Invalid Feed Key")]
    InvalidFeedKey,
}