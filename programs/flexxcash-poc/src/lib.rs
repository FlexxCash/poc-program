use anchor_lang::prelude::*;

declare_id!("5ZfoBUy5WUkGuWqTFUjkoFBUbVh74PSt7q2poVktNPo");

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