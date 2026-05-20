'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Place extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Place.init({
    gu_id: DataTypes.INTEGER,
    category: DataTypes.STRING,
    place_id: DataTypes.STRING,
    rating: DataTypes.DECIMAL,
    num_reviews: DataTypes.INTEGER,
    cached_at: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'Place',
  });
  return Place;
};