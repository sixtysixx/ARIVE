// ponytail — OpenCode plugin
export default async ({ client } = {}) => {
  return {
    'experimental.chat.system.transform': async (_input, output) => {
      output.system.push("PONYTAIL ACTIVE: Follow lazy senior developer rules.");
    }
  };
};