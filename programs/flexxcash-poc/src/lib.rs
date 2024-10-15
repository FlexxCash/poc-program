use anchor_lang::prelude::*;

declare_id!("HKm1EFY8eS97pwFCMX5EHWnaLKQv9zUstCq6QLoadzLv");

#[program]
pub mod flexxcash_poc {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}