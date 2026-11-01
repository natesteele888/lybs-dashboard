// ═══════════════════════════════════════════════════════════════════════════
// LYBS SOCIAL MODULE — Facebook Page Analysis
// Data embedded from Meta Business Suite export. Re-import via the upload button.
// ═══════════════════════════════════════════════════════════════════════════

const FB_IMPORT_KEY = 'lll_fb_posts';

// ── Embedded baseline data (update via "Update CSV" in the Social tab) ──────
const FB_BASELINE_POSTS = [{"id":"1119876693275367","date":"2025-03-15","month":"2025-03","title":"We are so excited for our last Tball Clinic of the season, TODAY at the Lunenburg MIDDLE/HIGH school at 1:00. Hope to see lots of kids there ready for some fun!","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02phb4WhdL3yMCAZ5Zwdd6mBrnXGBLdBGPBSXxe5GMe9nMcydBjYc4qkwYi4m264dNl","reach":190,"reactions":5,"comments":0,"shares":0,"clicks":15,"link_clicks":12},{"id":"1406189981310702","date":"2026-03-14","month":"2026-03","title":"We’re excited to welcome back Infinity Property Restoration  as a League Sponsor for the 2026 season! 🎉\n\nThank you to Infinity Property Restoration for their continued support of o","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0kLYp2LogTADPxuhAzmVQ6MpPSYP9UmhJpUDmfZvGXnMQAktHzkSR5fPd5M9fjNNXl","reach":104,"reactions":3,"comments":0,"shares":0,"clicks":5,"link_clicks":0},{"id":"1405503748045992","date":"2026-03-13","month":"2026-03","title":"Don’t miss the final baseball and softball clinic this Sunday, March 15th — the last chance to get some reps in before player evaluations on March 22nd! ⚾🥎\n\nPlayers can get extra s","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02tcdqN3in8b2Kx2bdsthBGgBhtrFooUVBq9ujbMvoQZ8GbRTfC5LjqAuwvyAP33cNl","reach":84,"reactions":1,"comments":0,"shares":0,"clicks":4,"link_clicks":4},{"id":"1405245031405197","date":"2026-03-13","month":"2026-03","title":"We’re looking for a few parent volunteers to help coach Coed T-Ball this spring. No experience needed—just a fun, positive environment for the kids. Commitment is up to two 1-hour ","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02R3ugVCA1jD34LbbSbPShmpjkLw7ZJLMq2g4PftGS9hx5mFZ9K7PrkSTQnEuQJFJxl","reach":492,"reactions":13,"comments":0,"shares":7,"clicks":18,"link_clicks":0},{"id":"1403879504875083","date":"2026-03-11","month":"2026-03","title":"⚾🥎 Parents: Getting Ready for the Season? 🥎⚾\n\nBefore you buy equipment, check out the two guides in the photos to make sure your player has everything they need this spring.\n\n✔️ Ba","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0Y9CHbfPRQ7QhEY9E64bbxKVk75jtGvBy4tVNGWvJexiyPrGNsNXWSZSm46k7Ecbbl","reach":356,"reactions":12,"comments":6,"shares":4,"clicks":167,"link_clicks":0},{"id":"1403269668269400","date":"2026-03-10","month":"2026-03","title":"We’re excited to welcome back McCaffrey Insurance Agency Inc Agency as a League Sponsor for the 2026 season! 🎉 Thank you for supporting our players and helping strengthen our commu","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0gSp2LC8RfpbYGfnLDnYYMLm7RzXi97YgjeoEa23s4ieByQzUtSJYK9faj8VyzvTwl","reach":140,"reactions":4,"comments":0,"shares":0,"clicks":3,"link_clicks":1},{"id":"1401596331770067","date":"2026-03-08","month":"2026-03","title":"We’re excited to welcome back Powell Stone & Gravel as a League Sponsor for the 2026 season! 🎉\n\nThank you to Powell Stone & Gravel for their continued support of our players and co","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0cFAUjGxLKKpcGBnYFp8XbKYrbNUD6FgMZcksLYyWQD2v1b6ueSgVCBvMvGqqRPMxl","reach":507,"reactions":6,"comments":0,"shares":0,"clicks":7,"link_clicks":1},{"id":"1401549251774775","date":"2026-03-08","month":"2026-03","title":"Looking forward to seeing everyone at today’s baseball and softball clinic! ⚾🥎 It’s great to see the kids back on the field, shaking off the winter and getting ready for the season","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0dhh9297tsh5ZM7csreMDmcdHVRVAsqF9CZUkJuVq2ZND6CD1TnahqhPxvRQ4rdLcl","reach":88,"reactions":6,"comments":0,"shares":0,"clicks":5,"link_clicks":3},{"id":"1401547381774962","date":"2026-03-08","month":"2026-03","title":"Excited for our final Coed T-Ball today! ⚾ The doors are open to new and returning players. Stop by and have some fun with us! 🙌","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02ao56Vzui3JC4byzGPx3psg4PHzGMzY6fr5umHSAyT8auJKPfNPYWZgE1FJDf5yzKl","reach":58,"reactions":2,"comments":0,"shares":0,"clicks":3,"link_clicks":2},{"id":"1400056615257372","date":"2026-03-06","month":"2026-03","title":"🚨 CLINIC REMINDER! 🚨\nJoin us this Sunday (3/8) for our LYBS Softball & Baseball Clinics at Fielder's Choice MA  (296 Summer St, Fitchburg).\n\n$10 per session (cash or Venmo) — ✅ No ","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0ibXgvsg9i8H2zip57DNNoKpWdduBgutrhogpNfrXtFnFh392urmD71PM66d92UpZl","reach":203,"reactions":5,"comments":0,"shares":2,"clicks":0,"link_clicks":0},{"id":"1399259148670452","date":"2026-03-05","month":"2026-03","title":"We’re excited to welcome Dillis & Roy Civil Design Group as a League Sponsor for the 2026 season! 🎉 Thank you for supporting our players and our community.\n\nNeed civil engineering,","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02bk1C3wYM1W4GuSoE9kU2Ai5EpaXqVZ8ViawAQ9xyspoSBQiWGPPD9GozHrG1TxT4l","reach":121,"reactions":4,"comments":0,"shares":0,"clicks":2,"link_clicks":1},{"id":"1398553085407725","date":"2026-03-04","month":"2026-03","title":"We’re excited to welcome back JP Doherty Construction as a League Sponsor for the 2026 season! 🎉\n\nThank you to JP Doherty Construction of Lunenburg, MA for their continued support ","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0LDZtJAei2wRLaLrHp9kGJQ4S9sMvPshsN4QvY3sTPgAp3CNuL9WGVkFSekPy5FVul","reach":178,"reactions":11,"comments":0,"shares":0,"clicks":11,"link_clicks":2},{"id":"1397899622139738","date":"2026-03-03","month":"2026-03","title":"⚾🥎 Registration is STILL OPEN! 🥎⚾\n\nThere’s still time to sign your player up for Lunenburg Youth Baseball & Softball — but don’t wait! Registration is open through March 20th.\n\nFro","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02tngaahA3YGTpBU7AN8MjSANbRU7jer7ds4VjWvGyro5RFLM5FrbB5CQT4Bpu4hANl","reach":247,"reactions":6,"comments":0,"shares":2,"clicks":15,"link_clicks":3},{"id":"1397287658867601","date":"2026-03-02","month":"2026-03","title":"🚨LYBS COED T-BALL CLINIC REMINDER!🚨\nBring your little slugger to a fun, no-cost, no-pressure intro to Coed T-Ball! Perfect for kids looking to try baseball for the first time, with","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0nKmQKPh1ifcZutNCZZmahc16eXpZvmP2JJLiiKdUeVjcJ5PM1aW8LxJAosZwz3nHl","reach":509,"reactions":13,"comments":0,"shares":4,"clicks":26,"link_clicks":0},{"id":"1395420102387690","date":"2026-02-28","month":"2026-02","title":"⏳⚾ FINAL DAY to Save! 🥎⏳\nToday is the last day to take advantage of our Early Bird Discount for Lunenburg Youth Baseball, Softball, and Coed T-Ball registration!\n\n🚨 $25 will be add","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02X8DmQzvxeWvabYSXL8v4FEzrrY9bepAvaZecRQmJR2fweSDmbYyXU2VhWozMoMC4l","reach":260,"reactions":6,"comments":0,"shares":3,"clicks":14,"link_clicks":7},{"id":"1394480375814996","date":"2026-02-27","month":"2026-02","title":"🚨 Don't Forget - Clinics this Sunday! 🚨\n\nThis is a great opportunity for players to sharpen their skills and get ready for the season.\n\n📅 Check the event page for times and details","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02QTqR3xgL5NpycJDAychr4q2LtDPtxhyJhY97wAbb45nnX8Yxtmep4uhpJzUNRAkjl","reach":109,"reactions":3,"comments":1,"shares":0,"clicks":5,"link_clicks":4},{"id":"1392877105975323","date":"2026-02-25","month":"2026-02","title":"🥎⚾️ Softball & Baseball Clinic Reminder! Sunday, 3/1 -  Fielder's Choice MA","type":"tryout","permalink":"https://www.facebook.com/reel/1414040900265062/","reach":181,"reactions":6,"comments":1,"shares":3,"clicks":8,"link_clicks":0},{"id":"1391188159477551","date":"2026-02-23","month":"2026-02","title":"❄️ 63 Days. That’s it. ⚾🥎\n\n63 days until the snow piles turn into dirt piles.�\n63 days until the fences echo with line drives instead of wind gusts.�\n63 days until we’re raking inf","type":"game","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02ugtKZZvKJRXefRWLs1VpBiJujqRHw9tDfM1vFzrHyzNGjBxhHL6mQcduhQHR9n4Zl","reach":568,"reactions":26,"comments":1,"shares":3,"clicks":41,"link_clicks":0},{"id":"1390497666213267","date":"2026-02-22","month":"2026-02","title":"🟢 Clinics Are a Go for Today! 🟢\n\nJoin us today, Sunday (2/22) for our LYBS Softball & Baseball Clinics at Fielder's Choice MA  (296 Summer St, Fitchburg)\n\n💲 $10 per session — ✅ No ","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0dgATfJZ3sxYeVoMD2XfyydPqjB1i5qbdsHCGUPP54xhVUEzcdABsw5ETtUprYKLml","reach":113,"reactions":2,"comments":0,"shares":0,"clicks":3,"link_clicks":0},{"id":"1390445529551814","date":"2026-02-22","month":"2026-02","title":"⏳ ONLY 7 DAYS LEFT!\nDon’t miss your chance to save with our Early Bird Registration discount!\n⚾ Register now and avoid the $25 fee increase starting March 1st.\n\nClinics are in full","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02QV9RePjdDhT1o9iKQyYRR437LYYHa3KWBmMFPWLSGdKayxswgjbCjr24BbhT5bssl","reach":241,"reactions":1,"comments":0,"shares":3,"clicks":7,"link_clicks":2},{"id":"1389505532979147","date":"2026-02-21","month":"2026-02","title":"🚨 **Clinics Tomorrow Are Still On** 🚨\n\nWe are closely monitoring the incoming storm. At this time, the clinics are still scheduled as planned. Please note that all activities are w","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02PtkA4YzcnPB2WvCXHQo7WcQDTMnFW93cVtSc1wkKojRbMyYJJkq195L9Egih7NfBl","reach":124,"reactions":5,"comments":0,"shares":0,"clicks":1,"link_clicks":0},{"id":"1388930993036601","date":"2026-02-20","month":"2026-02","title":"We’re excited to welcome back Nedloh Mechanical  as a League Sponsor for the 2026 season! 🎉 Thank you for supporting our players and helping strengthen our community.\n\nNedloh Mecha","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0vZ8781zonTqw6xAeTd1Gumz9QKkTDdM9tvnWHzLVGfkuiRuhB2ULgXPhtSnJD1YMl","reach":386,"reactions":25,"comments":0,"shares":3,"clicks":21,"link_clicks":3},{"id":"1386136233316077","date":"2026-02-17","month":"2026-02","title":"🚨 CLINIC REMINDER! 🚨\nJoin us this Sunday (2/22) for our LYBS Softball & Baseball Clinics at Fielder's Choice MA  (296 Summer St, Fitchburg).\n\n💲 $10 per session — ✅ No registration ","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/videos/939611961734531/","reach":503,"reactions":15,"comments":0,"shares":6,"clicks":14,"link_clicks":1},{"id":"1385399760056391","date":"2026-02-16","month":"2026-02","title":"Check out our New Gear at the Team Store!  \n👉 https://www.localprosports.biz/my-team-store/shop-my-team-store/#!/Lunenburg-Baseball-&-Softball/c/194742765\n\n7 Days Left to Shop!","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0p8HCE7LEL4SWqeG99EU3GCKtAP3NqsFATq3YL7qgS6iq9VbGy3NtAmGEffUgpMYml","reach":401,"reactions":8,"comments":0,"shares":4,"clicks":44,"link_clicks":12},{"id":"1384566603473040","date":"2026-02-15","month":"2026-02","title":"Hope everyone is having a great start to your February Vacation. Just a reminder - no clinics this week at Fielders Choice.\n\nNext clinic is Sunday, February 22nd at Fielder's Choic","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid07kvaH7a11rs75DUJbHkXcAedKGPCMyvZ6PAtrMFbtYfxXzB9uQb7GrAcmYbkAggGl","reach":369,"reactions":8,"comments":1,"shares":3,"clicks":23,"link_clicks":6},{"id":"1383719513557749","date":"2026-02-14","month":"2026-02","title":"⏳ ONLY 2 WEEKS LEFT!\nDon’t miss your chance to save with our Early Bird Registration discount!\n⚾ Register now and avoid the $25 fee increase starting March 1st.\n\nClinics are in ful","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02z3hxkk8aUh4oXc8Q3uj9hkc7W1BpP9DyEsPSxGbzR7cFrLHNtZZNbip1N41TspmGl","reach":804,"reactions":8,"comments":0,"shares":14,"clicks":22,"link_clicks":3},{"id":"1383015396961494","date":"2026-02-13","month":"2026-02","title":"We’re excited to welcome back Biotech Builders Group as a League Sponsor for the 2026 season! 🎉 Thank you for supporting our players and helping strengthen our community.\n\nBiotech ","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0hQqV9PwumJVuPchUuvJzwXaRsGmLt5zrLCLue95YL9yNcbcvtK3wn9gJ5imPtmm2l","reach":241,"reactions":9,"comments":0,"shares":0,"clicks":18,"link_clicks":8},{"id":"1380402580556109","date":"2026-02-10","month":"2026-02","title":"A huge thank you to our LYBS community for coming together for the Super Bowl fundraiser! 🏈 Your support and generosity helped raise funds for our new dugout at Powell Field. We’re","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0DLd6upbzhmLGM5p3wqEeU33rc4ZPpGYoNQLD1C1sP83fnodABReXGu61rM3j8XePl","reach":189,"reactions":9,"comments":1,"shares":0,"clicks":22,"link_clicks":0},{"id":"1379310003998700","date":"2026-02-09","month":"2026-02","title":"Happening today! Don’t miss our baseball clinic.\nRookies/Minors: 5-6:15PM — Majors: 6:45-8PM\nFielder's Choice MA 296 Summer St. Fitchburg","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02Fit6dwZQkAkRNs2iEdchnk3Uqev8tQLBoG3KmbGmhi4D566KQKD8v32wkYSKo6ZWl","reach":208,"reactions":5,"comments":0,"shares":2,"clicks":3,"link_clicks":0},{"id":"1377074590888908","date":"2026-02-06","month":"2026-02","title":"New fits are here! 👉 https://www.localprosports.biz/my-team-store/shop-my-team-store/#!/Lunenburg-Baseball-&-Softball/c/194742765\n\nThe LYBS Team Store is open with exclusive Lunenb","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02VwxuALDpRGZw54JQ4J9YqHf61CbQjU8ZvNWREbP96znm4AAvewWKsWgNqRAiqfbul","reach":436,"reactions":9,"comments":1,"shares":3,"clicks":83,"link_clicks":30},{"id":"1375953174334383","date":"2026-02-05","month":"2026-02","title":"⚾🥎 CLINIC REMINDER! 🥎⚾\n\nLYBS is hosting the 1st Baseball & Softball Clinics of the season at Fielder’s Choice — and you don’t need to pre-register!\n\n💵 $10 per session\n✅ No registra","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02G5xcxHs1m5gcjGZKZLTmuLJyPsWsLcvpUhqeYSjQdPwbmsA9VujCqErsuMcw2gGel","reach":766,"reactions":24,"comments":0,"shares":11,"clicks":27,"link_clicks":0},{"id":"1374924281103939","date":"2026-02-04","month":"2026-02","title":"🎉 SUPER BOWL SQUARES ARE OFFICIALLY SET! 🏈\n\nA huge THANK YOU to everyone who participated — the board is completely filled and all numbers have been assigned! 🙌\nGood luck to all pl","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02Vkw84dMUp728RLe8Dseyt3UvMtTwp6kjHkcePffsCgvfKWWB5PgWRTEZUCX7XYM9l","reach":276,"reactions":4,"comments":1,"shares":1,"clicks":50,"link_clicks":0},{"id":"1372542378008796","date":"2026-02-01","month":"2026-02","title":"🚨 FINAL CALL — Super Bowl Squares! 🚨\n\nToday is the last day to get in, and we’re down to just a dozen squares left!\n\nSupport Lunenburg Youth Baseball & Softball while adding some e","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02QQtNHFfKAsNjvNzjLmZ2c8RUke8WwwAmuomcxTb5mgEQTKR174px21mNvemuwMt1l","reach":593,"reactions":2,"comments":0,"shares":11,"clicks":29,"link_clicks":10},{"id":"1370137321582635","date":"2026-01-29","month":"2026-01","title":"We’re excited to welcome back Gilman Law as a League Sponsor for the 2026 season! 🎉\nThank you to Gilman Law for their generous support of our players and our community. As a proud ","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid029jhk8ttyJHvAbsPgv1mbMtWBPFZxGsF38NFscwoRALscVX9p4ktWQarQTjMPknDSl","reach":368,"reactions":20,"comments":0,"shares":0,"clicks":16,"link_clicks":4},{"id":"1370074664922234","date":"2026-01-29","month":"2026-01","title":"🏈 Super Bowl Squares are almost gone! 🏈\n⏳ ONLY 25 squares left\n\n🎯 Details:\n• $20 per square\n• Payouts every quarter ($100 / $300 / $100 / $500)\n• Numbers assigned randomly\n• Procee","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02CzkDmiLrJgLsGsmYgo61HhK6ZSMHbqNtQeU4n4wrFog2VxWtxTZw12F7svKwGAQRl","reach":280,"reactions":5,"comments":5,"shares":3,"clicks":33,"link_clicks":3},{"id":"1369570981639269","date":"2026-01-28","month":"2026-01","title":"🚨 Clinic Update! 🚨\nThe Patriots are heading to the Super Bowl, so our first baseball clinic is moving from Sunday to Monday. \n\nSoftball clinic stays on Sunday as planned. \n\n📅 New d","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02NUqWxYweWFhJ9KJ5k2dJvfe5tkUoe6Gr71TDP3qgCErYF79b9iN7FzsTkVaLJPfSl","reach":414,"reactions":3,"comments":2,"shares":4,"clicks":20,"link_clicks":0},{"id":"1367625691833798","date":"2026-01-26","month":"2026-01","title":"🏈Get Your Super Bowl Squares🏈\nGet in on the action and support Lunenburg Youth Baseball & Softball at the same time!\n\n💰 $20 per square\n🎉 Win at the end of each quarter!\n\nHow to pay","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid06wdsXMmb2eSQqVbbscT8H8mkn19aXbvjvcYGsUe9jGgW15Gd3iExsvtfpDNU53xcl","reach":775,"reactions":6,"comments":1,"shares":12,"clicks":16,"link_clicks":1},{"id":"1366584995271201","date":"2026-01-25","month":"2026-01","title":"Thank you to all the older ball players who showed up yesterday for the T-Ball clinic to help! \nSuch a great group that stepped up to help, showing great leadership to our young T-","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid025YpWnANCbwrmNeeTSRvn71cfsSo8HNzn7wdZMFocU1rzRVNRKmUNSDwPSwT6NbmBl","reach":476,"reactions":27,"comments":5,"shares":0,"clicks":59,"link_clicks":0},{"id":"1365661515363549","date":"2026-01-24","month":"2026-01","title":"Excited for our first T-ball clinic today from 1:30-2:30 at Turkey Hill in the Gym! Open to children age 4-6 as of May 1st. Come on down to let your players have some fun while pra","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02TGT23jUkRJVtmapB97jr4KuGSnMSfheTnh8YXMCXiaDKbk4xcqKmA132c2RKDBn5l","reach":143,"reactions":6,"comments":0,"shares":0,"clicks":24,"link_clicks":16},{"id":"1360578672538500","date":"2026-01-17","month":"2026-01","title":"Softball pitchers and catchers! Check out this clinic! \nTell your friends. \n\nhttps://www.facebook.com/share/17hdhDdx9j/","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02euhHvq1GXccnTdbmvha6f5MTU3TZp3JVVmbDrust9fqWrPzNcckr4paNDyMdZpaVl","reach":157,"reactions":2,"comments":0,"shares":0,"clicks":12,"link_clicks":12},{"id":"1358747532721614","date":"2026-01-15","month":"2026-01","title":"We’re excited to welcome back Pixelated Tech as a League Sponsor for the 2026 season! 🎉 Thank you for supporting our players and our community.\n\nLooking for reliable IT support or ","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid029xNV7Aoj9kaSUod3M2SALdey22MwhsYuoaEAwD5YsSVkm6eWSsT7iKD5zwsxgHpfl","reach":235,"reactions":7,"comments":0,"shares":0,"clicks":11,"link_clicks":0},{"id":"1354484443147923","date":"2026-01-09","month":"2026-01","title":"⚾🥎 REGISTRATION FOR THE SPRING SEASON IS NOW OPEN! 🥎⚾\n\nLunenburg Youth Baseball & Softball is excited to welcome players for another fun and competitive spring season. Don’t miss o","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid021n57ayzXEs7mqTdjagykCL7F1KL33ses41f8YQzSpK7dzgyRyBN59h14B6mktEM3l","reach":1316,"reactions":34,"comments":2,"shares":20,"clicks":79,"link_clicks":28},{"id":"1338476381415396","date":"2025-12-18","month":"2025-12","title":"⚾🥎 Lunenburg Youth Baseball & Softball Registration OPENS SOON! 🥎⚾\n\n📅 Registration for the 2026 season opens January 9th and runs through March 20th!\n\n✅ Programs for T-Ball, Baseba","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0SvuFzgHFfx9vXy7SJHoRv3Aa77XJgBocKkcmSeMVqgnVWUfEY4W4iQ9QBF4FqRuwl","reach":665,"reactions":22,"comments":5,"shares":7,"clicks":85,"link_clicks":5},{"id":"1332989095297458","date":"2025-12-10","month":"2025-12","title":"👀 New LYBS Gear in the works. Vote for your favorite look! 👇What apparel would you like to see? Comment below.","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02gmp7UEZ3mpk9o2dQtxmg2KZnHcUnycBery25BxdHuGgkp327WsPTAGiNG1pgozsRl","reach":639,"reactions":19,"comments":34,"shares":0,"clicks":192,"link_clicks":0},{"id":"1331994365396931","date":"2025-12-09","month":"2025-12","title":"🌟 LYBS T-Ball Clinics Are Back! 🌟\nBring your little slugger to a fun, no-cost, no-pressure intro to T-Ball! Perfect for kids looking to try baseball for the first time, with no com","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0mpw9peoQnkPwnEZx7v9Gy3LnvNen2Nt94f83eF7T16ccg3AEFM7JLjsRAV2B9WMDl","reach":1150,"reactions":28,"comments":3,"shares":13,"clicks":69,"link_clicks":0},{"id":"1328397189089982","date":"2025-12-04","month":"2025-12","title":"❕Correction: The original post listed the wrong dates — this has been fixed.\nLUNENBURG YOUTH BASEBALL & SOFTBALL CLINICS ARE BACK!\nNew to LYBS or a seasoned player—everyone is invi","type":"tryout","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0B3PPtZpx6EqbLWLZTwP4v4ffvCSXDxzner7huUUC7gDX74jMPkHPJt6FmqEKdzsRl","reach":841,"reactions":38,"comments":9,"shares":8,"clicks":99,"link_clicks":0},{"id":"1328385092424525","date":"2025-12-04","month":"2025-12","title":"Lunenburg Youth Baseball and Softball updated their cover photo.","type":"general","permalink":"https://www.facebook.com/photo.php?fbid=1328385092424525&set=a.179573957305650&type=3","reach":1,"reactions":11,"comments":0,"shares":0,"clicks":0,"link_clicks":0},{"id":"1323398912923143","date":"2025-11-27","month":"2025-11","title":"Always thankful for our players, families, and volunteers - Happy Thanksgiving to you and yours 🧡","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02DVMn4p5oYL4BJKvyh1YshsCXb2eApGwMoQWFap2kPdSsgELq1psQXsqodkruwrCml","reach":166,"reactions":9,"comments":0,"shares":1,"clicks":8,"link_clicks":0},{"id":"1322606433002391","date":"2025-11-26","month":"2025-11","title":"🦃 We’re feeling especially thankful for all of our amazing Lunenburg Youth Baseball & Softball sponsors!\n\nAs we head into the holiday, we want to share our gratitude for the incred","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid04XC7EjBR9SWFFTeSKeCGHzRazT3y16EKuosjpDGTkf1JahygUrJxagfis9snwfqbl","reach":457,"reactions":20,"comments":0,"shares":4,"clicks":34,"link_clicks":4},{"id":"1317895310140170","date":"2025-11-20","month":"2025-11","title":"🏈 SUPER BOWL SQUARES ARE HERE! 🏈\nSupport Lunenburg Youth Baseball & Softball and add some excitement to the big game!\n\nWe’re running a Super Bowl Squares Fundraiser — every square ","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid033yxPP5tSvuARxxHzzGkaw31fNSNf7mN3Xp9uiQ6phKZ91N8o3ZTkXsLYirJf5iHWl","reach":1512,"reactions":20,"comments":1,"shares":43,"clicks":101,"link_clicks":42},{"id":"1316631303599904","date":"2025-11-18","month":"2025-11","title":"Lunenburg Youth Baseball and Softball updated their profile picture.","type":"general","permalink":"https://www.facebook.com/photo.php?fbid=1316631303599904&set=a.179573963972316&type=3","reach":220,"reactions":16,"comments":0,"shares":0,"clicks":25,"link_clicks":0},{"id":"1316601846936183","date":"2025-11-18","month":"2025-11","title":"We are excited to introduce the NEW LUNENBURGYBS.COM!\nEasier Registration. Integrated Schedules. Team Pages.\n\nWe are excited to have you explore the site: https://www.lunenburgybs.","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid01McLk3UGZMxpwxNh1HovVRQuMZxaW85mvuLn5MaSb7RgPARV1zn5gWk4j3QC1N8Dl","reach":838,"reactions":30,"comments":4,"shares":7,"clicks":134,"link_clicks":48},{"id":"1316597030269998","date":"2025-11-18","month":"2025-11","title":"Lunenburg Youth Baseball and Softball updated their cover photo.","type":"general","permalink":"https://www.facebook.com/photo.php?fbid=1316597030269998&set=a.179573957305650&type=3","reach":1,"reactions":2,"comments":0,"shares":0,"clicks":0,"link_clicks":0},{"id":"1301495221780179","date":"2025-10-31","month":"2025-10","title":"🎃👻 Happy Halloween from Lunenburg Youth Baseball & Softball! ⚾🧡\n\nWishing all our players, families, and fans a fun, safe, and spooktacular night! Stay safe out there — and don’t le","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0WtkHGd7UGAVfMFxA3Auovhb5ij83QykUiq4LKk44ZSR8q7MyHHygnqTAhaS9Mt4l","reach":180,"reactions":6,"comments":0,"shares":1,"clicks":19,"link_clicks":0},{"id":"1289514476311587","date":"2025-10-17","month":"2025-10","title":"Hey all,\nOur Annual Board Meeting is \nTuesday, October 21st at 7 PM at the library. We'll be voting new people into positions, and discussing the upcoming season. Come join us if y","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02VbDQRppe2eyR5CZ1AbBckAy1spwEbmBUrjp4k7ocyua9BC8q4atQotNJP5mCqpYfl","reach":385,"reactions":8,"comments":0,"shares":1,"clicks":6,"link_clicks":0},{"id":"1210073427589026","date":"2025-07-12","month":"2025-07","title":"Summer registrations should all be refunded now. Let us know if you signed up and didn't see the refund come through.\n\nEnjoy summer everyone!","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02v6UWFLwdqAKhzPvauFH88Cu9QaCMKcf4PhKAnftLz25w3bpnQQFiMy1FeomtJKt2l","reach":251,"reactions":3,"comments":0,"shares":0,"clicks":8,"link_clicks":0},{"id":"1207762667820102","date":"2025-07-09","month":"2025-07","title":"Reminder to send us feedback about the season (good or bad!) via","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02bNbh2DcX3oe3h68PQ1FLk8451MBYgxWMGsscP2bowDcFUSpfkvn625M6hDot1TZql","reach":179,"reactions":0,"comments":0,"shares":0,"clicks":9,"link_clicks":9},{"id":"1207761674486868","date":"2025-07-09","month":"2025-07","title":"Hey all,\nSo summer ball is officially not happening through LYBS. We'll be refunding registrations in the next day or so.\nSorry for the delay, and have a good summer! \n\n(Some playe","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid023vnnBfYFH8xwgyiukvEWcNnLAqJJTRFe2GVrAD5KfksxmnFDZVQeYkJrNzSWuhG7l","reach":300,"reactions":0,"comments":0,"shares":0,"clicks":8,"link_clicks":0},{"id":"1199102778686091","date":"2025-06-28","month":"2025-06","title":"As we come to a close for the 2025 Spring Season of Lunenburg Youth Baseball and Softball, we want to thank everyone who participated, from the coaches, to the parents and players!","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02QXDmvF5LrhTWZaBZ1wuge12jg9vyAjv28z7iejKEXZY7DCLyVvoG7XaLpA63QbzAl","reach":406,"reactions":22,"comments":3,"shares":0,"clicks":47,"link_clicks":0},{"id":"1194933605769675","date":"2025-06-23","month":"2025-06","title":"All Stars games happened this weekend. Congrats to all the players who made their All-Star teams! Well deserved.\n10U softball played two games, and the teams Lunenburg was on won b","type":"game","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0295oojoeGzYNeoDg9hQXurhG9nh1DBW8JqrWLPewFgEdP4MyS4Keqr3bXvYzSThtrl","reach":555,"reactions":36,"comments":5,"shares":0,"clicks":299,"link_clicks":1},{"id":"1193719669224402","date":"2025-06-21","month":"2025-06","title":"The Lunenburg Minors are up 2-1 in the district tournament, taking a 7-4 win today! Keep it up boys!","type":"game","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02rfPHPt4VQr4d6beNzdfF2X2mgq3Ek3h3rFtD6oWJT5aLznyAv33tGbvYJ5fvQUzzl","reach":423,"reactions":27,"comments":0,"shares":0,"clicks":101,"link_clicks":0},{"id":"1192982939298075","date":"2025-06-20","month":"2025-06","title":"Tonight, both 16U Lunenburg teams faced off for the NCMS Championship! 🏆 What a game!\nBoth sides played incredibly well, with top level fielding, pitching and batting being shown t","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0WCVQYWW1Kd7NUmaTX3FKmcUZv9Hr6Gg5Y7C6zpsEpAtvnuDcp5w4tQSAkkRMn36Kl","reach":1520,"reactions":82,"comments":5,"shares":1,"clicks":283,"link_clicks":0},{"id":"1191943802735322","date":"2025-06-19","month":"2025-06","title":"Lunenburg 16U Knights earn a win in the playoffs.\n\nThat means, it'll be Lunenburg Blues vs Lunenburg Knights in the Championship! 🔥🥎\n\nFriday, 6/20 at 6PM at Marshall Park.","type":"game","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0MDELRB9iDU7SfzAKhUpk88HLfeEkGZrJQvNUZ9DRtrwqVfDqvBzi9k7qKeEYWXZ3l","reach":797,"reactions":46,"comments":1,"shares":0,"clicks":116,"link_clicks":0},{"id":"1191313176131718","date":"2025-06-18","month":"2025-06","title":"Marshall looking good in preparation for more playoff games!","type":"game","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0FWm7V8xnorGw1m69S9dKtgjtytovRcQJBRhNpbLSTH5rd2igoQvvMZhcsQqfbbjJl","reach":398,"reactions":19,"comments":0,"shares":0,"clicks":11,"link_clicks":0},{"id":"1190736059522763","date":"2025-06-17","month":"2025-06","title":"Lunenburg 16U Blues earn two wins in the playoffs, to secure their place in the Championship! Excellent job Blues!","type":"game","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02woRJWCNYmf47FNdh5eewDcHD3Cmn5ga6rGJsroaMHmJVQBUYh69JpawWwmGdd7abl","reach":512,"reactions":38,"comments":0,"shares":0,"clicks":60,"link_clicks":0},{"id":"1190509742878728","date":"2025-06-17","month":"2025-06","title":"Announcement: Summer ball registration is open until Friday.\n\nMost families should have gotten a notice from coaches.\nSign up on our website at lunenburgybs.com","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02AN52cPDvSnw3fGTZ7KS74CrjxxEhcjDES3ci8Ad8inMZAppPZkAc21J74UnWp4azl","reach":573,"reactions":4,"comments":1,"shares":4,"clicks":36,"link_clicks":4},{"id":"1188043873125315","date":"2025-06-14","month":"2025-06","title":"The Lunenburg Minors game went well. A real nail biter down to the end. \nCongrats to all the players, and congrats to the Blues for taking the w! Good luck in the remaining playoff","type":"game","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02stG9QBF85qZYeiFVrWuKtaELo7Rmt86UR612PY8UNifdFT9vfRWsqkL1N3n7dLEql","reach":526,"reactions":35,"comments":3,"shares":2,"clicks":169,"link_clicks":2},{"id":"1187381969858172","date":"2025-06-13","month":"2025-06","title":"Tonight, 6/13 at 5:45, come down to the Brian McNally field to watch the Lunenburg Minors teams face off in the Playoffs! \nShould be fun!","type":"game","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0twy3b9D3tGscoBbnZTsBNfuowBEEM566amqWWmT6gXYv9XPqasJqBkmsYyuF8cnvl","reach":384,"reactions":22,"comments":0,"shares":1,"clicks":14,"link_clicks":0},{"id":"1178851874044515","date":"2025-06-01","month":"2025-06","title":"Maddie Martins on the 16U Softball team hit an out of the park Grand Slam in tonight's game at Marshall Park! \nWay to go Maddie! 🥎🥎🥎","type":"game","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid05sw4ErLvW4HdcpcB2WjVgKM2F9ikaACoDe7iMGbZNzUTwGfvfQaBXFDcmVifoFbjl","reach":589,"reactions":78,"comments":6,"shares":0,"clicks":195,"link_clicks":1},{"id":"1175035831092786","date":"2025-05-27","month":"2025-05","title":"The LYBS Parade day, Hit-A-Thon, Picture Day, Ice Cream social was a huge success! We had a lot of fun. We started some new traditions and carried on some old ones! \nThanks to the ","type":"sponsor","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02x4pQ3Y9fqFRfWHbMDKJ4kB9Tpx1zth3eBeZny29ChziyswmQzgK2nbHoK762Ydgyl","reach":530,"reactions":29,"comments":0,"shares":1,"clicks":345,"link_clicks":0},{"id":"1167119938551042","date":"2025-05-16","month":"2025-05","title":"Looking forward to seeing you all tomorrow for Parade Day! \n8:45 start near the library, all teams in uniform! \n\nShould be fun.","type":"volunteer","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0tCPhrH4yU1n2qMxvEajbbHZ3R3fkuwXc6iNKH1Rfr7DLirTo5LwzcXxekkzkRRHvl","reach":273,"reactions":17,"comments":0,"shares":0,"clicks":9,"link_clicks":0},{"id":"1163056022290767","date":"2025-05-10","month":"2025-05","title":"","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02RHZTLXVqmoGAXtgxzeUceWJ9v95dvWjxsPuF2oLAehACBbmZQWTSwSM37kiFQb4al","reach":300,"reactions":8,"comments":0,"shares":0,"clicks":46,"link_clicks":0},{"id":"1161506822445687","date":"2025-05-08","month":"2025-05","title":"An important email was just sent to all LYBS families with information re our Opening Day Celebration on 5/17.\n\nIt includes information on our upcoming League-wide Opening Day, whi","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid08STYrUnR5kNjisT4Ce5a9R5w4fxDqsVN2qeCWskBXpwzt3vBMLd3Q1d3vkKicnF3l","reach":750,"reactions":12,"comments":0,"shares":5,"clicks":17,"link_clicks":1},{"id":"1156101609652875","date":"2025-04-30","month":"2025-04","title":"🚨**NEW**🚨 LYBS Apparel site is LIVE 🔥 🔥 🔥","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0YwAykz8YF4jFWFEJh2WNvB4er7aTJYHq8B3vTcpYLtLC2oTw6fhjWpnXPiqm2C9ql","reach":466,"reactions":12,"comments":7,"shares":2,"clicks":228,"link_clicks":124},{"id":"1152848466644856","date":"2025-04-26","month":"2025-04","title":"Save the date!\nMay 17, Parade Day, Hit-A-Thon, Picture Day!\nDetails soon","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0267Fk37tAVUZYykCWadCXNV7E8ufQhVfaFg8wwaemJsKrzAFube9J8418pgHgv6Krl","reach":555,"reactions":24,"comments":1,"shares":2,"clicks":28,"link_clicks":0},{"id":"1147178610545175","date":"2025-04-18","month":"2025-04","title":"Hey all,\nSorry for the late notice! A few of us will be down at Marshall Park at 8am on Saturday 4/19, doing a quick field cleanup.\nAnybody that is around, we'd appreciate any help","type":"volunteer","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0y9WHF6GU9VcnRbR6hHYaFXToJeLWUaJthoKMvT7xY7eWVfcs5jbi4D8mR9EAFc5Tl","reach":319,"reactions":3,"comments":0,"shares":0,"clicks":11,"link_clicks":0},{"id":"1139164488013254","date":"2025-04-08","month":"2025-04","title":"Tball Kick Off Event is CANCELLED for tonight due to forecasted weather. An email was sent out to all families as well. Practices for all teams start next week!","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02LtSo76SK6sjxovmGeg4Hx9a2jXEb9KevF3GpA6LG1RK9mBY5iHzWp4ho4VGTatarl","reach":413,"reactions":1,"comments":1,"shares":1,"clicks":20,"link_clicks":0},{"id":"1136392008290502","date":"2025-04-04","month":"2025-04","title":"Hey, we're going to postpone Field Cleanup. Tomorrow is looking iffy so we'll find a better day","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0jaRoNTtjPYM6cnnzqb7SKVXFMiAvDPgwPYQA5gkc2gDfnkT4w4SFXsEMp74Fv9rTl","reach":327,"reactions":9,"comments":0,"shares":0,"clicks":11,"link_clicks":0},{"id":"1131864705409899","date":"2025-03-30","month":"2025-03","title":"Lunenburg High School Baseball and Softball boosters are running a swag store until this Thursday! The boosters for our school sports are critical to keeping these sports running w","type":"volunteer","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid029NQaVNivGWitnQbeCuZHNL32QNpNaQenXRXCFVEeMYULmnnDyqLTkZvX3gMdt9eZl","reach":324,"reactions":1,"comments":0,"shares":1,"clicks":37,"link_clicks":35},{"id":"1126331829296520","date":"2025-03-23","month":"2025-03","title":"Today, March 23, is our Team Placement day! All non-tball players and coaches should join! No fee. Free!\nAlso, Registration Closes tonight.\n\nPlacement day information:\n\nAt Fielder'","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0MjhaDiiqEFa4truAg13B5PjC49prw9Zn2QBMvzHkJgw6iChVuM8qSFpUcvZdmddZl","reach":873,"reactions":39,"comments":6,"shares":3,"clicks":43,"link_clicks":0},{"id":"1120701359859567","date":"2025-03-16","month":"2025-03","title":"Hey all! \nWe're nearing the final week of registration! Registration closes on March 23, an important deadline to be able to order jerseys before the season starts!\nGood luck to al","type":"registration","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid02WZMBBzkoDBew9Kdpi85m4Mb2diftzExgWDfTEpYWcVGN5aBdDH7HUTTWVEdycdQDl","reach":1290,"reactions":16,"comments":2,"shares":12,"clicks":44,"link_clicks":21},{"id":"1134808755115494","date":"2025-04-02","month":"2025-04","title":"Field Cleanup Day is planned for this Saturday, April 5. However, weather doesn't seem to be cooperating.\n\nWe'll give a more concrete confirmation soon!","type":"general","permalink":"https://www.facebook.com/LunenburgYouthBaseballSoftball/posts/pfbid0yc9peYRUfuNj5rzC2Jc8WtBsrGQcA2GuTZdAYrxbsqrUxya7Wwn76nUhfBcP5VHRl","reach":366,"reactions":5,"comments":3,"shares":0,"clicks":47,"link_clicks":0}];

const FB_AUDIENCE = {
  cities: [
    { name: 'Lunenburg, MA', pct: 54.3 },
    { name: 'Leominster, MA', pct: 8.0 },
    { name: 'Fitchburg, MA', pct: 5.9 },
    { name: 'Shirley, MA', pct: 3.0 },
    { name: 'Worcester, MA', pct: 1.3 },
    { name: 'Townsend, MA', pct: 0.6 },
    { name: 'Sterling, MA', pct: 0.6 },
  ],
  ageGender: [
    { age: '18-24', women: 0.2, men: 1.7 },
    { age: '25-34', women: 4.8, men: 1.7 },
    { age: '35-44', women: 29.4, men: 9.4 },
    { age: '45-54', women: 23.6, men: 11.9 },
    { age: '55-64', women: 7.3, men: 4.4 },
    { age: '65+',   women: 3.2, men: 2.4 },
  ]
};

const FB_POST_TYPES = {
  registration: { label: 'Registration',  color: '#f5a623', emoji: '📋' },
  tryout:       { label: 'Tryout/Clinic',  color: '#10b981', emoji: '⚾' },
  game:         { label: 'Game/Results',   color: '#2563eb', emoji: '🏆' },
  sponsor:      { label: 'Sponsor/Fund',   color: '#a78bfa', emoji: '🤝' },
  volunteer:    { label: 'Volunteer',      color: '#60a5fa', emoji: '🙋' },
  general:      { label: 'General',        color: '#475569', emoji: '💬' },
};

function fbGetPosts() {
  try {
    const imp = localStorage.getItem(FB_IMPORT_KEY);
    if (imp) return JSON.parse(imp);
  } catch {}
  return FB_BASELINE_POSTS;
}

function fbMonthlyStats(posts) {
  const m = {};
  posts.forEach(p => {
    if (!m[p.month]) m[p.month] = { posts:0, reach:0, reactions:0, shares:0, clicks:0, types:{} };
    m[p.month].posts++;
    m[p.month].reach     += p.reach;
    m[p.month].reactions += p.reactions;
    m[p.month].shares    += p.shares;
    m[p.month].clicks    += p.clicks;
    m[p.month].types[p.type] = (m[p.month].types[p.type]||0) + 1;
  });
  return m;
}

function fbEngage(p) {
  return (p.reactions||0) + (p.comments||0)*2 + (p.shares||0)*3;
}

// ── CSV Import ─────────────────────────────────────────────────────────────
function fbImportCSV(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text  = e.target.result;
      const lines = text.split('\n');
      if (!lines.length) { toast('Empty file'); return; }
      // Find header row (has "Post ID")
      let hIdx = lines.findIndex(l => l.includes('Post ID'));
      if (hIdx < 0) { toast('Could not find Post ID column'); return; }
      const headers = lines[hIdx].replace(/^\uFEFF/,'').split(',').map(h => h.replace(/^"|"$/g,'').trim());
      const col = h => headers.indexOf(h);
      const parseRow = line => {
        // Simple CSV split respecting quotes
        const cols = []; let cur = '', inQ = false;
        for (const ch of line) {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
          else cur += ch;
        }
        cols.push(cur);
        return cols.map(c => c.replace(/^"|"$/g,'').trim());
      };

      const classify = text => {
        const t = text.toLowerCase();
        if (/register|registration|sign up|enroll|early bird|deadline|closes/.test(t)) return 'registration';
        if (/tryout|evaluation|clinic|placement/.test(t)) return 'tryout';
        if (/sponsor|donation|fundraiser|squares/.test(t)) return 'sponsor';
        if (/game|score|win|loss|playoff|champion|knights|blues/.test(t)) return 'game';
        if (/volunteer|coach|looking for/.test(t)) return 'volunteer';
        return 'general';
      };

      const posts = [];
      for (let i = hIdx + 1; i < lines.length; i++) {
        const row = parseRow(lines[i]);
        if (!row[col('Post ID')]?.match(/^\d+$/)) continue;
        const pub = row[col('Publish time')]||'';
        const parts = pub.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)/);
        if (!parts) continue;
        const dt = new Date(`${parts[3]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}T${parts[4].padStart(2,'0')}:${parts[5].padStart(2,'0')}`);
        const reach = parseInt(row[col('Reach')]||0)||0;
        if (!reach) continue;
        const title = (row[col('Title')]||'').slice(0,180);
        posts.push({
          id:   row[col('Post ID')],
          date: dt.toISOString().slice(0,10),
          month: dt.toISOString().slice(0,7),
          title,
          type: classify(title),
          permalink: row[col('Permalink')]||'',
          reach, reactions: parseInt(row[col('Reactions')]||0)||0,
          comments: parseInt(row[col('Comments')]||0)||0,
          shares:   parseInt(row[col('Shares')]||0)||0,
          clicks:   parseInt(row[col('Total clicks')]||0)||0,
          link_clicks: parseInt(row[col('Link Clicks')]||0)||0,
        });
      }
      if (!posts.length) { toast('No post data found in file'); return; }
      localStorage.setItem(FB_IMPORT_KEY, JSON.stringify(posts));
      toast(`✓ Imported ${posts.length} posts`);
      renderSocialSection();
    } catch(err) {
      toast('Import error: ' + err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
}

// ── Main render ────────────────────────────────────────────────────────────

function fbShowInsight(idx) {
  const ins = (window._fbInsights || [])[idx];
  if (!ins) return;
  fbShowPopup(ins.icon + ' ' + ins.label,
    '<div style="padding:4px 0 12px;font-size:13px;color:var(--text,#e2e8f0);line-height:1.7;">' +
    ins.detail + '</div>');
}


// ── Popup helper ──────────────────────────────────────────────────────────
function fbShowPopup(title, bodyHtml) {
  let existing = document.getElementById('fbPopupOverlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'fbPopupOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:var(--navy2,#0f2033);border:1px solid var(--border,#1e3a5f);border-radius:16px;
        padding:24px;max-width:520px;width:100%;max-height:85vh;overflow-y:auto;
        box-shadow:0 25px 60px rgba(0,0,0,0.6);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;flex:1;">${title}</div>
        <button onclick="document.getElementById('fbPopupOverlay').remove()"
          style="background:none;border:none;color:var(--text2,#94a3b8);cursor:pointer;font-size:18px;padding:0 4px;">✕</button>
      </div>
      ${bodyHtml}
    </div>`;
  document.body.appendChild(overlay);
}

function fbToggleSection(id) {
  const el = document.getElementById(id);
  const btn = document.getElementById(id + '_btn');
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : '';
  if (btn) btn.textContent = isOpen ? '▶ Show' : '▼ Hide';
}

// ── Popup content builders ────────────────────────────────────────────────
function fbPopupTotalPosts(posts, monthly) {
  const months = Object.keys(monthly).sort();
  const avg = Math.round(posts.length / months.length);
  const rows = months.map(m => {
    const d = monthly[m];
    const lbl = new Date(m+'-01').toLocaleString('en-US',{month:'long',year:'numeric'});
    const barW = Math.round(d.posts / Math.max(...months.map(x=>monthly[x].posts)) * 100);
    const isBest = d.posts === Math.max(...months.map(x=>monthly[x].posts));
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="min-width:110px;font-size:11px;color:${isBest?'var(--gold,#f5a623)':'var(--text,#e2e8f0)'};">${lbl}${isBest?' 🏆':''}</div>
      <div style="flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,0.08);overflow:hidden;">
        <div style="height:100%;width:${barW}%;background:${isBest?'var(--gold,#f5a623)':'#60a5fa'};border-radius:4px;"></div>
      </div>
      <div style="min-width:60px;text-align:right;font-size:11px;color:var(--text2,#94a3b8);">${d.posts} posts</div>
    </div>`;
  }).join('');
  fbShowPopup('📅 Month-over-Month Posts', `
    <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
      <div style="text-align:center;flex:1;">
        <div style="font-family:'Bebas Neue';font-size:36px;color:var(--gold,#f5a623);">${posts.length}</div>
        <div style="font-size:11px;color:var(--text2);">total posts</div>
      </div>
      <div style="text-align:center;flex:1;">
        <div style="font-family:'Bebas Neue';font-size:36px;color:#60a5fa;">${avg}</div>
        <div style="font-size:11px;color:var(--text2);">avg per month</div>
      </div>
      <div style="text-align:center;flex:1;">
        <div style="font-family:'Bebas Neue';font-size:36px;color:#10b981;">${months.length}</div>
        <div style="font-size:11px;color:var(--text2);">active months</div>
      </div>
    </div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px;">
      Aug–Sep 2025 had zero posts — a gap during the pre-announcement window before fall clinics launched.
    </div>
    ${rows}`);
}

function fbPopupTotalReach(posts, monthly) {
  const months = Object.keys(monthly).sort();
  const maxR = Math.max(...months.map(m=>monthly[m].reach));
  const rows = months.map(m => {
    const d = monthly[m];
    const lbl = new Date(m+'-01').toLocaleString('en-US',{month:'long',year:'numeric'});
    const barW = Math.round(d.reach / maxR * 100);
    const mom = months.indexOf(m) > 0 ? d.reach - monthly[months[months.indexOf(m)-1]].reach : null;
    const momStr = mom !== null ? (mom>0?`<span style="color:#10b981;">▲${mom.toLocaleString()}</span>`:`<span style="color:#ef4444;">▼${Math.abs(mom).toLocaleString()}</span>`) : '—';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="min-width:110px;font-size:11px;">${lbl}</div>
      <div style="flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,0.08);overflow:hidden;">
        <div style="height:100%;width:${barW}%;background:#2563eb;border-radius:4px;"></div>
      </div>
      <div style="min-width:55px;text-align:right;font-size:11px;color:#60a5fa;">${d.reach.toLocaleString()}</div>
      <div style="min-width:60px;text-align:right;font-size:11px;">${momStr}</div>
    </div>`;
  }).join('');
  const totalReach = posts.reduce((s,p)=>s+p.reach,0);
  fbShowPopup('📡 Month-over-Month Reach', `
    <div style="font-size:11px;color:var(--text2);margin-bottom:12px;">
      Reach = unique people who saw the post. Jun 2025 spike driven by playoff game posts.
      Feb 2026 spike from high-volume registration + clinic campaign.
    </div>
    <div style="display:flex;gap:10px;margin-bottom:14px;">
      <div style="font-family:'Bebas Neue';font-size:28px;color:#2563eb;flex:1;text-align:center;">
        ${totalReach.toLocaleString()}<div style="font-size:11px;color:var(--text2);font-family:'DM Sans';">total reach</div>
      </div>
      <div style="font-family:'Bebas Neue';font-size:28px;color:#60a5fa;flex:1;text-align:center;">
        ${Math.round(totalReach/posts.length).toLocaleString()}<div style="font-size:11px;color:var(--text2);font-family:'DM Sans';">avg/post</div>
      </div>
    </div>
    <div style="font-size:10px;color:var(--text2);text-align:right;margin-bottom:4px;">▲▼ vs prior month</div>
    ${rows}`);
}

function fbPopupRegPosts(posts) {
  const regPosts = posts.filter(p=>p.type==='registration').sort((a,b)=>b.reach-a.reach);
  const rows = regPosts.map((p,i) => {
    const dt = new Date(p.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'});
    const eng = fbEngage(p);
    const engCol = eng>100?'#10b981':eng>50?'#60a5fa':eng>20?'#f5a623':'var(--text2)';
    const title = p.title.replace(/[\n\r]+/g,' ').slice(0,80);
    return `<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="min-width:16px;font-size:10px;color:var(--text2);padding-top:1px;">${i+1}</div>
      <div style="flex:1;min-width:0;">
        <a href="${p.permalink}" target="_blank" style="font-size:11px;color:var(--text);text-decoration:none;display:block;
           white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${title}">${title}</a>
        <div style="font-size:10px;color:var(--text2);margin-top:1px;">${dt} · reach <strong style="color:#f5a623;">${p.reach.toLocaleString()}</strong> · 👍${p.reactions} 🔁${p.shares}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-family:'Bebas Neue';font-size:16px;color:${engCol};">${eng}</div>
        <div style="font-size:9px;color:var(--text2);">eng</div>
      </div>
    </div>`;
  }).join('');
  const avgReach = Math.round(regPosts.reduce((s,p)=>s+p.reach,0)/Math.max(regPosts.length,1));
  fbShowPopup('📋 All Registration Posts', `
    <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap;">
      <div style="text-align:center;flex:1;"><div style="font-family:'Bebas Neue';font-size:32px;color:#f5a623;">${regPosts.length}</div><div style="font-size:11px;color:var(--text2);">reg posts</div></div>
      <div style="text-align:center;flex:1;"><div style="font-family:'Bebas Neue';font-size:32px;color:#60a5fa;">${avgReach}</div><div style="font-size:11px;color:var(--text2);">avg reach</div></div>
    </div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:10px;">Sorted by reach. Engagement = likes + comments×2 + shares×3.</div>
    ${rows}`);
}

function fbPopupBestMonth(monthly, bestMonth) {
  const d = monthly[bestMonth];
  const lbl = new Date(bestMonth+'-01').toLocaleString('en-US',{month:'long',year:'numeric'});
  const typeRows = Object.entries(d.types).sort((a,b)=>b[1]-a[1]).map(([type,n]) => {
    const info = FB_POST_TYPES[type]||{emoji:'💬',label:type,color:'#475569'};
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
      <span>${info.emoji}</span>
      <span style="flex:1;font-size:12px;color:var(--text);">${info.label}</span>
      <span style="font-family:'Bebas Neue';font-size:16px;color:${info.color};">${n}</span>
    </div>`;
  }).join('');
  fbShowPopup(`🏆 ${lbl} — Peak Month`, `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
      <div class="stat-card" style="flex:1;min-width:80px;text-align:center;">
        <div style="font-family:'Bebas Neue';font-size:28px;color:#10b981;">${d.reach.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text2);">reach</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:80px;text-align:center;">
        <div style="font-family:'Bebas Neue';font-size:28px;color:var(--gold);">${d.posts}</div>
        <div style="font-size:10px;color:var(--text2);">posts</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:80px;text-align:center;">
        <div style="font-family:'Bebas Neue';font-size:28px;color:#60a5fa;">${d.reactions}</div>
        <div style="font-size:10px;color:var(--text2);">reactions</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:80px;text-align:center;">
        <div style="font-family:'Bebas Neue';font-size:28px;color:#a78bfa;">${d.shares}</div>
        <div style="font-size:10px;color:var(--text2);">shares</div>
      </div>
    </div>
    <div style="font-family:'Bebas Neue';font-size:14px;margin-bottom:8px;">Post breakdown</div>
    ${typeRows}
    <div style="margin-top:12px;font-size:11px;color:var(--text2);padding:8px 10px;
        background:rgba(245,166,35,0.08);border-radius:8px;border:1px solid rgba(245,166,35,0.2);">
      ${(() => {
        const bm = bestMonth || '';
        const mo = parseInt((bm.split('-')[1])||0);
        const yr = bm.split('-')[0] || '';
        const lbl = bm ? new Date(bm+'-01').toLocaleString('en-US',{month:'long',year:'numeric'}) : '';
        if (mo === 6) return '💡 ' + lbl + ' peak likely driven by playoff posts — game results consistently get top organic reach. Post every result.';
        if (mo <= 2 || mo === 12) return '💡 ' + lbl + ' peak driven by registration campaign — high-volume posting during signup windows directly boosts enrollment.';
        return '💡 ' + lbl + ' had the highest reach — strong community engagement during this period.';
      })()}
    </div>`);
}

// ── Main render ────────────────────────────────────────────────────────────
function renderSocialSection() {
  const el = document.getElementById('socialSection');
  if (!el) return;

  const posts    = fbGetPosts();
  const monthly  = fbMonthlyStats(posts);
  const months   = Object.keys(monthly).sort();
  const isImport = !!localStorage.getItem(FB_IMPORT_KEY);

  const totalReach = posts.reduce((s,p)=>s+p.reach,0);
  const totalReactions = posts.reduce((s,p)=>s+p.reactions,0);
  const avgReachPerPost = Math.round(totalReach / posts.length);
  const regPosts  = posts.filter(p => p.type === 'registration');
  const avgRegReach = regPosts.length ? Math.round(regPosts.reduce((s,p)=>s+p.reach,0)/regPosts.length) : 0;
  const bestMonth = months.reduce((best,m) => monthly[m].reach > (monthly[best]?.reach||0) ? m : best, months[0]);
  const bestMonthLabel = bestMonth ? new Date(bestMonth+'-01').toLocaleString('en-US',{month:'short',year:'numeric'}) : '—';

  // ── Monthly chart ─────────────────────────────────────────────────────
  const maxReach = Math.max(...months.map(m => monthly[m].reach));
  const monthBars = months.map((m) => {
    const d = monthly[m];
    const pct = maxReach ? Math.round(d.reach / maxReach * 100) : 0;
    const regCount = d.types.registration||0;
    const col = regCount >= 3 ? '#f5a623' : regCount >= 1 ? '#f5a62399' : (d.types.game||0) >= 3 ? '#2563eb' : '#475569';
    const lbl = new Date(m+'-01').toLocaleString('en-US',{month:'short',year:'2-digit'});
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-width:0;">
      <div style="font-size:9px;font-weight:700;color:${regCount?'#f5a623':'transparent'};">${regCount||'·'}</div>
      <div style="width:100%;background:rgba(255,255,255,0.06);border-radius:3px;height:54px;display:flex;align-items:flex-end;cursor:pointer;"
        onclick="fbPopupMonthDetail(fbGetPosts(),fbMonthlyStats(fbGetPosts()),'${m}')"
        title="${lbl}: ${d.posts} posts, reach ${d.reach.toLocaleString()}">
        <div style="width:100%;background:${col};border-radius:3px 3px 0 0;height:${Math.max(pct,3)}%;"></div>
      </div>
      <div style="font-size:8px;color:var(--text2);white-space:nowrap;">${lbl}</div>
    </div>`;
  }).join('');

  // ── Post type breakdown ───────────────────────────────────────────────
  const typeTotals = {};
  posts.forEach(p => {
    typeTotals[p.type] = typeTotals[p.type] || {count:0,reach:0};
    typeTotals[p.type].count++;
    typeTotals[p.type].reach += p.reach;
  });
  const typeBreakdown = Object.entries(typeTotals).sort((a,b)=>b[1].count-a[1].count).map(([type,d])=>{
    const info = FB_POST_TYPES[type]||{emoji:'💬',label:type,color:'#475569'};
    const pct = Math.round(d.count/posts.length*100);
    const avgR = Math.round(d.reach/d.count);
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="font-size:13px;">${info.emoji}</span>
      <span style="font-size:11px;flex:1;">${info.label}</span>
      <div style="flex:2;height:7px;border-radius:4px;background:rgba(255,255,255,0.07);">
        <div style="height:100%;width:${pct}%;background:${info.color};border-radius:4px;"></div>
      </div>
      <span style="font-size:10px;color:var(--text2);min-width:22px;text-align:right;">${d.count}</span>
      <span style="font-size:10px;color:${info.color};min-width:62px;text-align:right;">avg reach ${avgR}</span>
    </div>`;
  }).join('');

  // ── Audience ─────────────────────────────────────────────────────────
  const audienceBars = FB_AUDIENCE.ageGender.map(ag=>`
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
      <div style="font-size:10px;color:var(--text2);min-width:36px;text-align:right;">${ag.age}</div>
      <div style="flex:1;display:flex;gap:1px;">
        <div style="flex:${ag.women};height:10px;background:#ec4899;border-radius:2px 0 0 2px;" title="Women ${ag.women}%"></div>
        <div style="flex:${ag.men};height:10px;background:#2563eb;border-radius:0 2px 2px 0;" title="Men ${ag.men}%"></div>
      </div>
      <div style="font-size:9px;min-width:58px;"><span style="color:#ec4899;">${ag.women}%</span> / <span style="color:#2563eb;">${ag.men}%</span></div>
    </div>`).join('');

  const cityBars = FB_AUDIENCE.cities.slice(0,5).map(c=>`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <div style="font-size:10px;color:var(--text2);min-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name}</div>
      <div style="flex:1;height:7px;border-radius:3px;background:rgba(255,255,255,0.07);">
        <div style="height:100%;width:${c.pct}%;background:var(--gold,#f5a623);border-radius:3px;"></div>
      </div>
      <div style="font-size:10px;color:var(--gold);min-width:32px;text-align:right;">${c.pct}%</div>
    </div>`).join('');

  // ── Insights — compact chips, stored globally so onclick can ref by index ─
  // ── Insights — generated from actual post data ─────────────────────────
  const bestRegPost  = posts.filter(p=>p.type==='registration').sort((a,b)=>b.reach-a.reach)[0];
  const bestGamePost = posts.filter(p=>p.type==='game').sort((a,b)=>b.reach-a.reach)[0];
  const topViralPost = [...posts].sort((a,b)=>(b.shares||0)-(a.shares||0))[0];
  const gapMonths = (() => {
    if (!months.length) return '';
    const first = new Date(months[0]+'-01'), last = new Date(months[months.length-1]+'-01');
    const gaps = []; let cur = new Date(first);
    while (cur <= last) {
      const key = cur.toISOString().slice(0,7);
      if (!monthly[key] || monthly[key].posts === 0)
        gaps.push(new Date(key+'-01').toLocaleString('en-US',{month:'short',year:"2-digit"}));
      cur.setMonth(cur.getMonth()+1);
    }
    return gaps.length ? gaps.slice(0,3).join(', ') : '';
  })();
  const bmd = monthly[bestMonth];
  const womPct = (FB_AUDIENCE && FB_AUDIENCE.ageGender)
    ? Math.round(FB_AUDIENCE.ageGender.reduce((s,a)=>s+(a.women||0),0)/FB_AUDIENCE.ageGender.length) : 67;
  window._fbInsights = [
    bestRegPost ? { icon:'📈', col:'#10b981',
      label:'Best reg post: ' + bestRegPost.reach.toLocaleString() + ' reach',
      detail:(bestRegPost.date ? new Date(bestRegPost.date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'Top reg post')
        + ' got ' + (bestRegPost.shares||0) + ' shares — opening-day posts drive the most organic reach to non-followers.' } : null,
    bmd ? { icon:'📅', col:'#f5a623',
      label:bestMonthLabel + ': ' + bmd.posts + ' posts, ' + bmd.reach.toLocaleString() + ' reach',
      detail:'Best single month by reach. Heavy posting periods align with peak enrollment — consistent volume works.' } : null,
    bestGamePost ? { icon:'🏆', col:'#2563eb',
      label:'Top game post: ' + bestGamePost.reach.toLocaleString() + ' reach',
      detail:'Game result posts reach ~' + Math.round(bestGamePost.reach/Math.max(1,avgReachPerPost)) + '× average. The community shares wins — post every game result, especially playoffs.' } : null,
    topViralPost && (topViralPost.shares||0) > 5 ? { icon:'📣', col:'#a78bfa',
      label:'Most shared: ' + topViralPost.shares + ' shares',
      detail:'"' + (topViralPost.content||'Top post').slice(0,60) + '…" was your most shared post. Fundraiser and community content spreads fastest — reuse that format.' } : null,
    { icon:'👩', col:'#ec4899',
      label:womPct + '% women audience',
      detail:'Your audience skews female — typically moms 35–44. Urgency ("last chance", "deadline") resonates more than general announcements with this group.' },
    gapMonths ? { icon:'⚠️', col:'#f97316',
      label:'Posting gap: ' + gapMonths,
      detail:'Zero posts during ' + gapMonths + '. Prime window for fall outreach — clinics, early reg preview, team photo recaps. Gaps miss registration pipeline.' } : null,
  ].filter(Boolean);
  const insightHtml = '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:16px;">' +
    window._fbInsights.map((ins, idx) =>
      '<div onclick="fbShowInsight(' + idx + ')" ' +
      'style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:20px;cursor:pointer;' +
      'background:' + ins.col + '15;border:1px solid ' + ins.col + '33;" ' +
      'onmouseover="this.style.background=\'' + ins.col + '28\';" ' +
      'onmouseout="this.style.background=\'' + ins.col + '15\';">' +
      '<span style="font-size:13px;">' + ins.icon + '</span>' +
      '<span style="font-size:11px;font-weight:600;color:' + ins.col + ';">' + ins.label + '</span>' +
      '</div>'
    ).join('') +
  '</div>';

  // ── Top posts (collapsed) ─────────────────────────────────────────────
  const topPosts = [...posts].sort((a,b)=>fbEngage(b)-fbEngage(a)).slice(0,10);
  const topPostsHtml = topPosts.map((p,i) => {
    const info = FB_POST_TYPES[p.type]||FB_POST_TYPES.general;
    const eng  = fbEngage(p);
    const dt   = new Date(p.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'});
    const engCol = eng>100?'#10b981':eng>50?'#60a5fa':eng>20?'#f5a623':'var(--text2)';
    const title = p.title.replace(/[\n\r]+/g,' ').replace(/\s+/g,' ').slice(0,100);
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;
        border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border);margin-bottom:6px;">
      <div style="min-width:18px;font-size:10px;color:var(--text2);padding-top:2px;text-align:center;">${i+1}</div>
      <span style="font-size:15px;flex-shrink:0;">${info.emoji}</span>
      <div style="flex:1;min-width:0;">
        <a href="${p.permalink}" target="_blank"
          style="font-size:11px;color:var(--text);text-decoration:none;display:block;
                 white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${title}">${title||'(no caption)'}</a>
        <div style="font-size:10px;color:var(--text2);margin-top:2px;">
          ${dt} · <span style="color:${info.color};">${info.label}</span> · reach <strong style="color:var(--text);">${p.reach.toLocaleString()}</strong>
          · 👍${p.reactions} 💬${p.comments} 🔁${p.shares}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;padding-left:6px;">
        <div style="font-family:'Bebas Neue';font-size:18px;color:${engCol};">${eng}</div>
        <div style="font-size:9px;color:var(--text2);">engage</div>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
  <div class="card" style="margin-top:0;">
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
      <div style="font-family:'Bebas Neue';font-size:22px;letter-spacing:1px;">
        📱 Social Media <span style="color:var(--gold,#f5a623);">Insights</span>
      </div>
      <span style="font-size:11px;color:var(--text2);">${isImport ? 'Imported data' : (months.length >= 2 ? new Date(months[0]+'-01').toLocaleString('en-US',{month:'short',year:'numeric'})+' – '+new Date(months[months.length-1]+'-01').toLocaleString('en-US',{month:'short',year:'numeric'}) : 'Baseline data')} · ${posts.length} posts</span>
      <label style="margin-left:auto;cursor:pointer;">
        <input type="file" accept=".csv" onchange="fbImportCSV(this.files[0])" style="display:none;">
        <span class="btn btn-ghost btn-sm" style="font-size:11px;">↑ Update CSV</span>
      </label>
    </div>

    <!-- Clickable stat cards -->
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">
      <div class="stat-card stat-clickable" style="flex:1;min-width:90px;cursor:pointer;"
        onclick="fbPopupTotalPosts(fbGetPosts(),fbMonthlyStats(fbGetPosts()))">
        <div class="stat-card-trend">📅</div>
        <div class="stat-label">Total Posts</div>
        <div style="font-family:'Bebas Neue';font-size:32px;color:var(--gold);">${posts.length}</div>
        <div style="font-size:10px;color:var(--text2);">click for month breakdown</div>
      </div>
      <div class="stat-card stat-clickable" style="flex:1;min-width:90px;cursor:pointer;"
        onclick="fbPopupTotalReach(fbGetPosts(),fbMonthlyStats(fbGetPosts()))">
        <div class="stat-card-trend">📡</div>
        <div class="stat-label">Total Reach</div>
        <div style="font-family:'Bebas Neue';font-size:32px;color:#2563eb;">${totalReach.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text2);">click for month-over-month</div>
      </div>
      <div class="stat-card stat-clickable" style="flex:1;min-width:90px;cursor:pointer;"
        onclick="fbPopupRegPosts(fbGetPosts())">
        <div class="stat-card-trend">📋</div>
        <div class="stat-label">Reg Post Reach</div>
        <div style="font-family:'Bebas Neue';font-size:32px;color:#f5a623;">${avgRegReach}</div>
        <div style="font-size:10px;color:var(--text2);">avg · click for all ${regPosts.length} reg posts</div>
      </div>
      <div class="stat-card stat-clickable" style="flex:1;min-width:90px;cursor:pointer;"
        onclick="fbPopupBestMonth(fbMonthlyStats(fbGetPosts()),'${bestMonth}')">
        <div class="stat-card-trend">🏆</div>
        <div class="stat-label">Peak Month</div>
        <div style="font-family:'Bebas Neue';font-size:20px;color:#10b981;line-height:1.2;">${bestMonthLabel}</div>
        <div style="font-size:10px;color:var(--text2);">click for details</div>
      </div>
    </div>

    <!-- Monthly chart -->
    <div style="font-family:'Bebas Neue';font-size:15px;letter-spacing:1px;margin-bottom:4px;">
      Monthly Reach <span style="font-size:10px;font-family:'DM Sans';font-weight:400;color:var(--text2);">
        · bars = reach · 🟡 gold = reg-heavy · 🔵 blue = game-heavy · <strong style="color:#f5a623;">numbers</strong> = reg post count · click any bar for detail
      </span>
    </div>
    <div style="display:flex;gap:4px;align-items:flex-end;height:80px;margin-bottom:20px;padding:0 2px;">
      ${monthBars}
    </div>

    <!-- Insights -->
    <div style="font-family:'Bebas Neue';font-size:15px;letter-spacing:1px;margin-bottom:10px;">
      Key <span style="color:var(--gold);">Insights</span>
    </div>
    ${insightHtml}

    <!-- Breakdown + Audience side by side -->
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:4px;margin-bottom:4px;">
      <div style="flex:1;min-width:200px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;"
          onclick="fbPopupTypeBreakdown(fbGetPosts())">
          <div style="font-family:'Bebas Neue';font-size:15px;letter-spacing:1px;">
            Post Type <span style="color:var(--gold);">Breakdown</span>
          </div>
          <span style="font-size:10px;color:var(--text2);">↗ click to expand</span>
        </div>
        ${typeBreakdown}
      </div>
      <div style="flex:1;min-width:180px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer;"
          onclick="fbPopupAudience()">
          <div style="font-family:'Bebas Neue';font-size:14px;letter-spacing:1px;">
            Audience <span style="color:var(--gold);">Age & Gender</span>
          </div>
          <span style="font-size:10px;color:var(--text2);">↗ click to expand</span>
        </div>
        ${audienceBars}
        <div style="display:flex;gap:12px;margin-top:4px;margin-bottom:14px;">
          <span style="font-size:10px;color:#ec4899;">● Women</span>
          <span style="font-size:10px;color:#2563eb;">● Men</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer;"
          onclick="fbPopupCities()">
          <div style="font-family:'Bebas Neue';font-size:14px;letter-spacing:1px;">
            Top <span style="color:var(--gold);">Cities</span>
          </div>
          <span style="font-size:10px;color:var(--text2);">↗ click to expand</span>
        </div>
        ${cityBars}
      </div>
    </div>

    <!-- Top posts — collapsed by default -->
    <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:12px;">
      <div style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;"
        onclick="fbToggleSection('fbTopPosts')">
        <div style="font-family:'Bebas Neue';font-size:15px;letter-spacing:1px;flex:1;">
          Top Posts by <span style="color:var(--gold);">Engagement</span>
          <span style="font-size:10px;font-family:'DM Sans';font-weight:400;color:var(--text2);margin-left:6px;">
            likes + comments×2 + shares×3 · click title to open on Facebook
          </span>
        </div>
        <span id="fbTopPosts_btn" style="font-size:11px;color:var(--text2);flex-shrink:0;">▶ Show</span>
      </div>
      <div id="fbTopPosts" style="display:none;margin-top:10px;">
        ${topPostsHtml}
      </div>
    </div>
  </div>`;
}

// ── Month detail popup ────────────────────────────────────────────────────
function fbPopupMonthDetail(posts, monthly, month) {
  const d = monthly[month];
  if (!d) return;
  const lbl = new Date(month+'-01').toLocaleString('en-US',{month:'long',year:'numeric'});
  const monthPosts = posts.filter(p => p.month === month).sort((a,b)=>fbEngage(b)-fbEngage(a));
  const postRows = monthPosts.map(p => {
    const info = FB_POST_TYPES[p.type]||FB_POST_TYPES.general;
    const eng = fbEngage(p);
    const dt = new Date(p.date).toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const title = p.title.replace(/[\n\r]+/g,' ').slice(0,75);
    return `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <span style="font-size:13px;">${info.emoji}</span>
      <div style="flex:1;min-width:0;">
        <a href="${p.permalink}" target="_blank" style="font-size:11px;color:var(--text);text-decoration:none;
           white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;" title="${title}">${title}</a>
        <div style="font-size:10px;color:var(--text2);">${dt} · reach ${p.reach.toLocaleString()} · 👍${p.reactions} 🔁${p.shares}</div>
      </div>
      <div style="font-family:'Bebas Neue';font-size:15px;color:${eng>50?'#10b981':eng>20?'#60a5fa':'var(--text2)'};flex-shrink:0;">${eng}</div>
    </div>`;
  }).join('');

  fbShowPopup(`📅 ${lbl}`, `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div class="stat-card" style="flex:1;text-align:center;min-width:70px;">
        <div style="font-family:'Bebas Neue';font-size:26px;color:var(--gold);">${d.posts}</div>
        <div style="font-size:10px;color:var(--text2);">posts</div>
      </div>
      <div class="stat-card" style="flex:1;text-align:center;min-width:70px;">
        <div style="font-family:'Bebas Neue';font-size:26px;color:#2563eb;">${d.reach.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text2);">reach</div>
      </div>
      <div class="stat-card" style="flex:1;text-align:center;min-width:70px;">
        <div style="font-family:'Bebas Neue';font-size:26px;color:#10b981;">${d.reactions}</div>
        <div style="font-size:10px;color:var(--text2);">reactions</div>
      </div>
      <div class="stat-card" style="flex:1;text-align:center;min-width:70px;">
        <div style="font-family:'Bebas Neue';font-size:26px;color:#a78bfa;">${d.shares}</div>
        <div style="font-size:10px;color:var(--text2);">shares</div>
      </div>
    </div>
    <div style="font-family:'Bebas Neue';font-size:13px;margin-bottom:8px;">All posts this month</div>
    ${postRows||'<div style="color:var(--text2);font-size:12px;">No posts with reach data</div>'}`);
}


// ── Type breakdown popup ──────────────────────────────────────────────────
function fbPopupTypeBreakdown(posts) {
  const typeTotals = {};
  posts.forEach(p => {
    typeTotals[p.type] = typeTotals[p.type] || {count:0,reach:0,reactions:0,shares:0};
    typeTotals[p.type].count++;
    typeTotals[p.type].reach     += p.reach;
    typeTotals[p.type].reactions += p.reactions;
    typeTotals[p.type].shares    += p.shares;
  });
  const sorted = Object.entries(typeTotals).sort((a,b)=>b[1].reach/b[1].count - a[1].reach/a[1].count);
  const maxAvg = Math.max(...sorted.map(([,d])=>Math.round(d.reach/d.count)));
  const rows = sorted.map(([type,d]) => {
    const info = FB_POST_TYPES[type]||{emoji:'💬',label:type,color:'#475569'};
    const avgR = Math.round(d.reach/d.count);
    const avgE = Math.round((d.reactions + d.shares*3)/d.count);
    const pct  = Math.round(avgR/maxAvg*100);
    return `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span>${info.emoji}</span>
        <span style="font-size:12px;font-weight:700;flex:1;">${info.label}</span>
        <span style="font-size:10px;color:var(--text2);">${d.count} posts</span>
        <span style="font-family:'Bebas Neue';font-size:16px;color:${info.color};">${avgR} avg reach</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.08);">
          <div style="height:100%;width:${pct}%;background:${info.color};border-radius:3px;"></div>
        </div>
        <span style="font-size:10px;color:var(--text2);min-width:80px;text-align:right;">avg engage ${avgE}</span>
      </div>
    </div>`;
  }).join('');
  fbShowPopup('📊 Post Type Performance', `
    <div style="font-size:11px;color:var(--text2);margin-bottom:12px;">
      Sorted by average reach per post. Shows which content types actually get seen.
    </div>
    ${rows}
    <div style="margin-top:12px;padding:8px 10px;background:rgba(245,166,35,0.08);border-radius:8px;
        border:1px solid rgba(245,166,35,0.2);font-size:11px;color:var(--text2);">
      💡 Registration posts have the highest reach because they get shared. Game posts have the highest engagement because fans react and comment.
    </div>`);
}

// ── Audience popup ─────────────────────────────────────────────────────────
function fbPopupAudience() {
  const ageRows = FB_AUDIENCE.ageGender.map(ag => {
    const total = ag.women + ag.men;
    return `<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
        <span style="font-size:11px;color:var(--text2);min-width:36px;">${ag.age}</span>
        <div style="flex:1;display:flex;gap:2px;height:12px;">
          <div style="flex:${ag.women};background:#ec4899;border-radius:2px 0 0 2px;" title="Women ${ag.women}%"></div>
          <div style="flex:${ag.men};background:#2563eb;border-radius:0 2px 2px 0;" title="Men ${ag.men}%"></div>
        </div>
        <span style="font-size:10px;min-width:70px;text-align:right;">
          <span style="color:#ec4899;">${ag.women}%</span> · <span style="color:#2563eb;">${ag.men}%</span>
          <span style="color:var(--text2);margin-left:4px;">(${total.toFixed(1)}%)</span>
        </span>
      </div>
    </div>`;
  }).join('');
  const totalWomen = FB_AUDIENCE.ageGender.reduce((s,ag)=>s+ag.women,0).toFixed(1);
  const totalMen   = FB_AUDIENCE.ageGender.reduce((s,ag)=>s+ag.men,0).toFixed(1);
  fbShowPopup('👥 Audience Demographics', `
    <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
      <div style="flex:1;text-align:center;padding:10px;background:rgba(236,72,153,0.1);border-radius:8px;border:1px solid rgba(236,72,153,0.25);">
        <div style="font-family:'Bebas Neue';font-size:32px;color:#ec4899;">${totalWomen}%</div>
        <div style="font-size:11px;color:var(--text2);">Women</div>
      </div>
      <div style="flex:1;text-align:center;padding:10px;background:rgba(37,99,235,0.1);border-radius:8px;border:1px solid rgba(37,99,235,0.25);">
        <div style="font-family:'Bebas Neue';font-size:32px;color:#2563eb;">${totalMen}%</div>
        <div style="font-size:11px;color:var(--text2);">Men</div>
      </div>
    </div>
    <div style="font-family:'Bebas Neue';font-size:13px;margin-bottom:8px;">By Age Group</div>
    ${ageRows}
    <div style="margin-top:12px;padding:8px 10px;background:rgba(236,72,153,0.08);border-radius:8px;
        border:1px solid rgba(236,72,153,0.2);font-size:11px;color:var(--text2);">
      💡 35–44 women (29.4%) are your core audience — youth sports moms. Content with urgency, community pride, and player milestones resonates most with this group.
    </div>`);
}

// ── Cities popup ───────────────────────────────────────────────────────────
function fbPopupCities() {
  const cityRows = FB_AUDIENCE.cities.map((c,i) => {
    const isLocal = c.name.includes('Lunenburg');
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="min-width:18px;font-size:10px;color:var(--text2);text-align:center;">${i+1}</div>
      <div style="flex:1;font-size:12px;font-weight:${isLocal?700:400};color:${isLocal?'var(--gold)':'var(--text)'};">
        ${c.name}${isLocal?' 🏠':''}
      </div>
      <div style="flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,0.08);">
        <div style="height:100%;width:${c.pct}%;background:${isLocal?'var(--gold,#f5a623)':'#60a5fa'};border-radius:4px;"></div>
      </div>
      <div style="font-size:11px;font-weight:700;color:${isLocal?'var(--gold)':'#60a5fa'};min-width:36px;text-align:right;">${c.pct}%</div>
    </div>`;
  }).join('');
  const localPct = FB_AUDIENCE.cities.filter(c=>['Lunenburg','Leominster','Fitchburg','Shirley'].some(t=>c.name.includes(t))).reduce((s,c)=>s+c.pct,0);
  fbShowPopup('📍 Audience by City', `
    <div style="display:flex;gap:12px;margin-bottom:14px;">
      <div style="flex:1;text-align:center;padding:10px;background:rgba(245,166,35,0.08);border-radius:8px;border:1px solid rgba(245,166,35,0.2);">
        <div style="font-family:'Bebas Neue';font-size:28px;color:var(--gold);">54.3%</div>
        <div style="font-size:11px;color:var(--text2);">Lunenburg local</div>
      </div>
      <div style="flex:1;text-align:center;padding:10px;background:rgba(96,165,250,0.08);border-radius:8px;border:1px solid rgba(96,165,250,0.2);">
        <div style="font-family:'Bebas Neue';font-size:28px;color:#60a5fa;">${localPct.toFixed(1)}%</div>
        <div style="font-size:11px;color:var(--text2);">surrounding towns</div>
      </div>
    </div>
    ${cityRows}
    <div style="margin-top:12px;padding:8px 10px;background:rgba(96,165,250,0.08);border-radius:8px;
        border:1px solid rgba(96,165,250,0.2);font-size:11px;color:var(--text2);">
      💡 Leominster (8%) and Fitchburg (5.9%) are your biggest feeder towns after Lunenburg itself — worth targeting with event posts when registration is open.
    </div>`);
}


// Self-invoke once loaded
if (document.getElementById("socialSection")) {
  renderSocialSection();
}
