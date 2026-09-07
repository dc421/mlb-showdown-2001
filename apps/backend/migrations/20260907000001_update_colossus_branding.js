exports.shorthands = undefined;

exports.up = pgm => {
  pgm.sql(`
    UPDATE teams
    SET primary_color = '#C4E9E3',
        secondary_color = '#C68346',
        logo_url = 'https://mlbshowdown2001.netlify.app/images/colossus.png'
    WHERE name = 'Colossus' AND city = 'New York';
  `);
};

exports.down = pgm => {
  pgm.sql(`
    UPDATE teams
    SET primary_color = '#6C6F70',
        secondary_color = '#FCC623',
        logo_url = 'https://i.ibb.co/9H2FNp78/Gemini-Generated-Image-9m7wx39m7wx39m7w.png'
    WHERE name = 'Colossus' AND city = 'New York';
  `);
};
